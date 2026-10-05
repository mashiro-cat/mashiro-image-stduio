//! 缩略图命令（IPC 薄封装，实际计算在 `super::render`）。
//!
//! 命令名与参数名是公开契约：`src/platform/media.ts` 按名字 invoke，别重命名。

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::AppHandle;

use image::GenericImageView;

use crate::fs::paths::guard_path;

use super::cache;
use super::render;
use super::MAX_CONCURRENT;
use super::MAX_EDGE_LIMIT;

/// 全局并发闸门：`Mutex<usize>` 记录正在解码的张数。
///
/// 为什么用这种「土办法」而不是 `tokio::sync::Semaphore`：
/// 解码本身跑在 `spawn_blocking` 里（同步、不可 await），
/// 用 `try_lock` 循环 + `yield_now` 就能实现同样的限流，
/// 且不必把整个命令改成 async 还要处理 permit 的生命周期。
/// 槽位只有 [`MAX_CONCURRENT`] 个，轮询等待的开销可以忽略。
static GATE: Mutex<usize> = Mutex::new(0);

/// 取一个解码槽位；拿不到就让出执行权再重试。
///
/// 用 `lock()` 而不是 `try_lock()`：信号量本身不会长时间被持有
/// （只在计数的那几微秒内），`unwrap_or_else(|e| e.into_inner())`
/// 那条毒路径只在别的线程 panic 时才会走到。
fn acquire_slot() {
    loop {
        {
            let mut guard = GATE.lock().unwrap_or_else(|e| e.into_inner());
            if *guard < MAX_CONCURRENT {
                *guard += 1;
                return;
            }
        }
        // 槽位满了：让出线程调度，避免空转烧 CPU
        std::thread::yield_now();
    }
}

fn release_slot() {
    let mut guard = GATE.lock().unwrap_or_else(|e| e.into_inner());
    *guard = guard.saturating_sub(1);
}

/** 缩略图结果 */
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Thumbnail {
    /// 缩略图的绝对路径（前端直接 `convertFileSrc` 用它）
    pub path: String,
    /// 实际的长边像素（小于请求值说明原图本身就这么小）
    pub width: u32,
    pub height: u32,
    /// 是否命中已有缓存（前端可据此决定要不要提示「已缓存」）
    pub cached: bool,
}

// 缩略图长边的合法区间
const EDGE_MIN: u32 = 64;
const EDGE_DEFAULT: u32 = 512;

/// 把前端传来的长边归一化到合法区间。
///
/// **注意：0 在这里会被抬成 64 而不是「不要缩略图」**——
/// 「0 = 用原图」必须由前端 `media.thumbnailUrl` 自己短路掉，
/// 它一旦发到 Rust 就只能被解释成「给我一张最小的缩略图」。
/// 前端那道判断是这道钳位的前提，改任一边都要同步（见 media.ts 同名注释）。
fn resolve_edge(max_edge: Option<u32>) -> u32 {
    max_edge
        .unwrap_or(EDGE_DEFAULT)
        .clamp(EDGE_MIN, MAX_EDGE_LIMIT)
}

// 超过这个字节数才值得走缩略图管线（见 `use_thumbnail` 的说明）
const WORTH_IT_BYTES: u64 = 8 * 1024 * 1024;

/// 这张图**值不值得**生成缩略图。
///
/// # 为什么要按文件大小设门槛（而不是一律生成）
///
/// 本机实测（50 张真实图，47 张 ≤ 4.2MB、中位 1.2MB）：
///
/// | 原图 | WebView 直接解码 | 缩略图全流程 |
/// |---|---|---|
/// | 1.7MB | **7ms** | **577ms** |
/// | 9.8MB | 44ms | ~1s |
/// | 125.6MB | 569ms | 8.3s（**只有这里划算**） |
///
/// 缩略图管线的成本（IPC 往返 + 解码 + 缩放 + JPEG 编码 + 写盘 + 再解码）
/// 对小图是**净负担**——比直接显示原图慢两个数量级。
/// 它唯一的价值是「原图大到 WebView 解码会卡住主线程」的场景。
///
/// 所以 8MB 以下直接判「不值得」，让前端回退加载原图：
/// 那 7~44ms 本来就无感，为它建一整套缓存是纯浪费。
/// 8MB 这个门槛离两侧都很远（1.7MB→7ms，125MB→569ms），
/// 不需要精确调参——**它只是把「明显不划算」和「明显划算」分开**。
///
/// **别因为「加个门槛很优雅」就保留全量缩略图**：先量分布再定策略。
/// 这是一开始就该做的——我先看到 126MB 的异常值就照它设计了架构。
fn worth_it(bytes: u64) -> bool {
    bytes > WORTH_IT_BYTES
}

/**
 * 取一张图的缩略图，命中缓存则直接返回。
 *
 * `source` 来自前端，**必须过 `guard_path`**——这条命令会读文件。
 *
 * `max_edge` 是目标长边（像素）。不给时用 512：覆盖绝大多数列表缩略图场景
 * （历史卡片 224px 宽、首页 gallery 168px），在 2x 屏上仍然清晰。
 *
 * 解码是 CPU + 内存密集的同步操作（8192² 的 PNG 峰值 256MB），因此：
 * - 放 `spawn_blocking`，绝不在命令线程上跑（那会卡住 Tauri worker）；
 * - 经 [`acquire_slot`] 限并发，避免几十张同时解码把内存打爆。
 */
#[tauri::command]
pub async fn image_thumbnail(
    app: AppHandle,
    source: String,
    max_edge: Option<u32>,
) -> Result<Option<Thumbnail>, String> {
    let src = guard_path(&app, &source)?;
    if !src.is_file() {
        return Err("图片文件不存在".to_string());
    }
    // 小图直接判「不值得」→ 返回 None，前端回退加载原图。
    // 这条比阈值调优重要得多：它让 99% 的图片根本不走这套管线。
    let bytes = std::fs::metadata(&src).map(|m| m.len()).unwrap_or(0);
    if !worth_it(bytes) {
        return Ok(None);
    }
    let edge = resolve_edge(max_edge);
    let dir = cache::dir(&app)?;
    let dest = cache::thumb_path(&dir, &src, edge)
        .ok_or_else(|| "无法从图片路径推导缩略图文件名".to_string())?;

    // 命中缓存：不占解码槽位，直接返回。
    // 尺寸从文件名里带的 edge 反推不出来（可能比 edge 更小），
    // 交给前端首次渲染时的 naturalWidth 校正显示。
    if cache::is_cached(&dest) {
        return Ok(Some(Thumbnail {
            width: edge,
            height: edge,
            path: dest.to_string_lossy().to_string(),
            cached: true,
        }));
    }

    // 第一层 `?` 拆掉 JoinHandle（任务 panic），第二层才是 build 自己的 Result
    let (path, w, h) =
        tauri::async_runtime::spawn_blocking(move || -> Result<(PathBuf, u32, u32), String> {
            acquire_slot();
            // 无论成功失败都必须还槽位，否则闸门会被永久占满
            let outcome = build(&src, &dest, edge);
            release_slot();
            outcome
        })
        .await
        .map_err(|e| format!("缩略图任务异常终止：{e}"))??;

    Ok(Some(Thumbnail {
        width: w,
        height: h,
        path: path.to_string_lossy().to_string(),
        cached: false,
    }))
}

/// 解码缩放并落盘，返回（最终路径, 宽, 高）
fn build(
    src: &std::path::Path,
    dest: &std::path::Path,
    edge: u32,
) -> Result<(PathBuf, u32, u32), String> {
    // 排队期间可能已被另一个请求生成了（同一批里重复引用同一张图很常见）
    if cache::is_cached(dest) {
        return Ok((dest.to_path_buf(), edge, edge));
    }

    let bytes = render::encode_thumbnail(src, edge)?;

    // `.part` + rename：同目录下的 rename 在各平台都是原子的，
    // 读方永远看不到「写了一半」的缩略图。
    let part = dest.with_extension("jpg.part");
    crate::fs::paths::ensure_parent(dest)?;
    std::fs::write(&part, &bytes).map_err(|e| format!("写入缩略图失败: {e}"))?;
    std::fs::rename(&part, dest).map_err(|e| format!("保存缩略图失败: {e}"))?;

    // 尺寸以真实产物为准：原图可能比 edge 还小。
    // `dimensions()` 来自 `GenericImageView` trait，必须显式引入作用域。
    let (w, h) = image::load_from_memory_with_format(&bytes, image::ImageFormat::Jpeg)
        .map(|img| img.dimensions())
        .unwrap_or((edge, edge));

    Ok((dest.to_path_buf(), w, h))
}

/// 删掉 `dir` 下所有属于 `source` 的缩略图，返回删除张数。
///
/// 缩略图文件名是从原图 stem 派生的（`{stem}_{edge}.jpg`），
/// 而**尺寸是前端传的**，后端事先不知道会生成哪些——所以只能按前缀扫目录。
///
/// 唯一调用方是 `fs::commands::remove_path`：删原图时顺手清缓存。
/// 前端不需要（也不应该）直接调它——命名规则是本域的内部约定，
/// 泄漏出去等于把缓存布局变成公开契约。
///
/// 纯函数形式（不碰 AppHandle）便于测试。
pub(crate) fn purge_for(dir: &std::path::Path, source: &std::path::Path) -> usize {
    let Some(stem) = source.file_stem().and_then(|s| s.to_str()) else {
        return 0;
    };
    let prefix = format!("{stem}_");
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        // 必须同时满足「以 stem_ 开头」和「.jpg 结尾」，
        // 否则 `img_abc_512.jpg` 会误删 `img_abc_512.png`（将来若加别的格式）
        if name.starts_with(&prefix) && name.ends_with(".jpg") {
            if std::fs::remove_file(entry.path()).is_ok() {
                removed += 1;
            }
        }
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn resolve_edge_clamps_into_legal_range() {
        assert_eq!(resolve_edge(None), 512, "不给时用默认 512");
        assert_eq!(resolve_edge(Some(256)), 256, "合法值原样通过");
        assert_eq!(resolve_edge(Some(MAX_EDGE_LIMIT)), MAX_EDGE_LIMIT);
        // 过小的值抬到下限——注意 0 也走这里，所以前端必须自己拦掉 0
        assert_eq!(resolve_edge(Some(1)), 64);
        assert_eq!(resolve_edge(Some(0)), 64);
        // 超过上限要压回来，防止「缩略图」又变回原图
        assert_eq!(resolve_edge(Some(999_999)), MAX_EDGE_LIMIT);
    }

    #[test]
    fn worth_it_skips_small_images_where_pipeline_is_a_pure_loss() {
        // 本机实测：1.7MB 图 WebView 直接解码 7ms，而缩略图全流程 577ms。
        // 门槛之下的图必须判「不值得」，否则对 99% 的图片是 80 倍的负优化。
        assert!(!worth_it(0));
        assert!(!worth_it(1_700_000), "1.7MB 实测只要 7ms，不该走管线");
        assert!(!worth_it(4 * 1024 * 1024));
        assert!(!worth_it(WORTH_IT_BYTES), "门槛本身取等号时不算");
        // 门槛之上才生成：9.8MB 起缩略图开始有收益
        assert!(worth_it(WORTH_IT_BYTES + 1));
        assert!(worth_it(9_800_000));
        assert!(worth_it(125_600_000));
    }

    /// 小图（≤8MB）必须返回 `None` 而不是报错或返回缩略图。
    ///
    /// 这条契约的前半段是性能（小图不值得走管线），**后半段更关键**：
    /// 前端 `displayUrl` 见到 `None` 会回退加载**原图**。
    /// 如果这里改成报错，前端只会静默回退（catch 分支）；
    /// 如果这里返回一张缩略图，则阈值形同虚设。
    /// 两种情况都不会「报错给用户」，但只有 `Ok(None)` 走的是正确分支。
    #[test]
    fn worth_it_matches_the_documented_8mb_boundary() {
        // 边界两侧各测一次，确保用的是 > 而不是 >=
        assert!(!worth_it(WORTH_IT_BYTES));
        assert!(worth_it(WORTH_IT_BYTES + 1));
        // 本机真实分布里最常见的那一档
        assert!(!worth_it(1_700_000));
        assert!(!worth_it(2_400_000));
    }

    /// 每个测试一个独立临时目录。
    ///
    /// **目录名必须带上测试自己的标识**：cargo 默认在同一进程里用多个线程
    /// 并行跑测试，只用 pid 命名会让两个测试共用一个目录——
    /// 先跑完的那个 `remove_dir_all` 会把另一个正在用的目录删掉，
    /// 表现为「单独跑绿、全量跑红」的偶发失败。
    fn fixture(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("mashiro-thumb-test-{}-{tag}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn purge_removes_all_sizes_of_the_same_stem() {
        let dir = fixture("purge-sizes");
        let source = dir.join("img_abc.png");
        fs::write(&source, b"x").unwrap();
        for edge in [128u32, 512, 1024] {
            fs::write(dir.join(format!("img_abc_{edge}.jpg")), b"x").unwrap();
        }
        // 同目录下别的图片的缩略图，必须活下来
        fs::write(dir.join("img_xyz_512.jpg"), b"x").unwrap();
        // 前缀相同但不是 .jpg（将来可能加 webp），也不该被动
        fs::write(dir.join("img_abc_512.png"), b"x").unwrap();

        let removed = purge_for(&dir, &source);
        assert_eq!(removed, 3, "应删掉该图的全部 3 个尺寸");
        assert!(dir.join("img_xyz_512.jpg").exists(), "误删了别的图");
        assert!(dir.join("img_abc_512.png").exists(), "误删了非 .jpg 文件");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn purge_is_safe_when_dir_missing() {
        let dir = fixture("purge-missing");
        let missing = dir.join("nope");
        let source = dir.join("img_abc.png");
        assert_eq!(purge_for(&missing, &source), 0);
        let _ = fs::remove_dir_all(&dir);
    }
}

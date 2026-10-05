//! 模型注册表与 `Session` 缓存。
//!
//! # 为什么注册表要显式写死归一化方式
//!
//! Real-ESRGAN 的 ONNX 导出**没有统一契约**，不同导出者的约定差别很大：
//! 有的输入是 RGB `[0,1]`，有的是 BGR `[0,1]`，还有的按训练时的 `[-1,1]`。
//! 猜错的后果很隐蔽——**不会报错，只会出偏色或糊掉的图**。
//! 所以这里把 `ValueRange` 做成模型元信息的一部分，由模型自己声明，
//! 推理时按声明换算；新增模型必须先确认导出方的约定再填。
//!
//! # Session 为什么缓存
//!
//! `Session::builder().commit_from_file()` 要解析图、优化算子、分配内存，
//! 实测 1~2 秒。逐张图重建会话会让「连点 5 张」变成十几秒的等待。
//! 推理是不可变的（同一份权重反复调用没有副作用），所以全局保留一个会话即可，
//! 用 `Mutex` 串行化——ONNX Runtime 的单会话本身不保证并发安全，
//! 而超分是用户手动触发的低频操作，串行完全够用。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use ort::session::Session;

use crate::http::client::shared_client;
use crate::upscale::ep::Backend;

/// 模型输入的数值约定。**见模块文档：猜错不报错，只会出偏色图。**
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ValueRange {
    /// `[0, 1]`，多数 Real-ESRGAN ONNX 导出的做法
    ZeroOne,
    /// `[-1, 1]`，部分按训练时归一化导出的版本。
    ///
    /// 当前注册表里的模型都走 `ZeroOne`，这个变体是为后续接入
    /// Nomos / SwinIR 等其他架构预留的——它们的导出约定不统一，
    /// 宁可在这里显式枚举也不要靠猜。
    #[allow(dead_code)]
    MinusOneOne,
}

impl ValueRange {
    /// 把 `[0,255]` 的 u8 像素换算到本模型约定的范围
    pub fn encode(self, v: u8) -> f32 {
        let x = v as f32 / 255.0;
        match self {
            ValueRange::ZeroOne => x,
            ValueRange::MinusOneOne => x * 2.0 - 1.0,
        }
    }

    /// 逆运算：把模型输出夹回 `[0,255]`
    pub fn decode(self, v: f32) -> u8 {
        let x = match self {
            ValueRange::ZeroOne => v,
            ValueRange::MinusOneOne => (v + 1.0) * 0.5,
        };
        // 推理输出偶尔越界（GAN 输出无界），不夹会直接 wrap 成花屏
        (x.clamp(0.0, 1.0) * 255.0).round() as u8
    }
}

/// 一个可下载的超分模型。
///
/// 字段刻意只留推理必需的：展示文案与下载地址。新增模型时
/// **`value_range` 与 `scale` 必须对着导出方的说明确认**，别从名字推。
pub struct UpscaleModel {
    /// 稳定标识，存进设置项，前端按它取配置
    pub id: &'static str,
    /// 界面展示名
    pub label: &'static str,
    /// 一句话说明适用场景，设置页列表里当副标题
    pub note: &'static str,
    /// 放大倍数。**必须与模型实际输出一致**，
    /// 填错会让用户拿到尺寸对不上的图
    pub scale: u32,
    /// 输入数值约定
    pub value_range: ValueRange,
    /// 预计体积（字节），设置页下载前展示
    pub size_bytes: u64,
    /// 候选下载地址，按顺序尝试。
    ///
    /// 国内直连 huggingface.co 常常超时/被墙，因此把镜像排在前面，
    /// 官方源留作兜底——这与 `components/prompt/RemoteImage.vue`
    /// 对仓库案例图做的多候选兜底是同一个思路。
    pub urls: &'static [&'static str],
}

impl UpscaleModel {
    /// 缓存到磁盘的文件名（用 id 而非 URL 末段，改源时不用改文件名）
    pub fn file_name(&self) -> String {
        format!("{}.onnx", self.id)
    }
}

/// 全部可选模型。
///
/// **首个是默认项**——选了体积最小、速度最快、且**经彩度验收**的那个，
/// 让用户点「超分」时不用先做选择。
///
/// # 选型硬性验收：必须过「彩度测试」
///
/// **看契约（shape / dtype / 动态轴）不足以判断模型能不能用。**
/// 反面教材：注册表里原来的默认 `realesrgan-x4-int8` 契约完美
/// （`[-1,3,-1,-1]` Float32、4× 动态轴），但实测**把纯红 (255,0,0)
/// 输出成 R=82.5 G=82.4 B=81.9 的纯灰** —— 它是 PBR 贴图专用的导出版，
/// 训练目标就是去饱和，颜色信息在网络内部就丢了。
///
/// 验收方法：喂一张**彩度拉满**的纯 RGB 色块图（红/绿/蓝三块），
/// 看输出三通道是否仍然明显不同。彩度 > 15% 才算通过。
/// 验过的结果写在各模型的 `note` 里。
pub const MODELS: &[UpscaleModel] = &[
    // 默认项：插画/动漫专用，2.4MB、275ms/块、彩度 100%
    UpscaleModel {
        id: "realesr-animevideov3",
        label: "Real-ESRGAN AnimeVideo v3",
        note: "插画 / 动漫最佳 · 2.4MB 最快 · 保彩度已验证 · 4 倍",
        scale: 4,
        value_range: ValueRange::ZeroOne,
        size_bytes: 2_492_908,
        urls: &[
            "https://hf-mirror.com/skillsafe-ai/realesr-animevideov3/resolve/main/model.onnx",
            "https://huggingface.co/skillsafe-ai/realesr-animevideov3/resolve/main/model.onnx",
        ],
    },
    // 通用照片：4.7MB、562ms/块、彩度 100%
    UpscaleModel {
        id: "realesr-general-x4v3",
        label: "Real-ESRGAN General v3",
        note: "通用照片 / 写实 · 4.7MB · 保彩度已验证 · 4 倍",
        scale: 4,
        value_range: ValueRange::ZeroOne,
        size_bytes: 4_866_428,
        urls: &[
            "https://hf-mirror.com/skillsafe-ai/realesr-general-x4v3/resolve/main/model.onnx",
            "https://huggingface.co/skillsafe-ai/realesr-general-x4v3/resolve/main/model.onnx",
        ],
    },
    // 保留旧模型但降级：它是 PBR 贴图专用导出版，**会去饱和**
    UpscaleModel {
        id: "realesrgan-x4-int8",
        label: "Real-ESRGAN x4 (INT8，旧版)",
        note: "⚠ 去饱和：实测纯红输出纯灰，彩色图会明显偏色 · 仅纹理图可用",
        scale: 4,
        value_range: ValueRange::ZeroOne,
        size_bytes: 17_549_307,
        urls: &[
            "https://hf-mirror.com/Wszelkiebro/reliquary-realesrgan-x4-int8/resolve/main/realesrgan_x4_int8.onnx",
            "https://huggingface.co/Wszelkiebro/reliquary-realesrgan-x4-int8/resolve/main/realesrgan_x4_int8.onnx",
        ],
    },
];

/// 按 id 查模型
pub fn find(id: &str) -> Result<&'static UpscaleModel, String> {
    MODELS
        .iter()
        .find(|model| model.id == id)
        .ok_or_else(|| format!("未知的超分模型：{id}"))
}

/// 默认模型 id
pub fn default_model_id() -> &'static str {
    MODELS[0].id
}

/* ------------------------------------------------------------ 会话缓存 */

/**
 * 会话缓存：`id -> 该模型会话的独占访问器。
 *
 * 为什么不直接缓存 `Session` 或 `&mut Session`：
 * `Session::run` 要 `&mut self`，而把 `&mut` 存进 map 再借出来会跟
 * 「守卫要持有 map 的锁」直接冲突——借用检查器会正确地拒绝（E0505/E0597）。
 *
 * 所以缓存的是 `Arc<Mutex<Session>>`：map 存的是**可克隆的句柄**，
 * 守卫 clone 一份 Arc 出来独占那个 Mutex，与 map 本身脱钩。
 * 生命周期问题因此消失，语义也更直白——「谁拿到 Arc 谁独占这个会话」。
 *
 * 附带效果：推理天然串行化（同一个 Mutex）。超分是用户手动触发的低频操作，
 * 排队完全够用，反而比并发更安全。
 */
/// 缓存的键：`模型 id + 后端`。
///
/// **必须把后端算进键**：CPU 与 GPU 的会话不能混用，
/// 否则用户关掉 GPU 加速后拿到的还是那个 GPU 会话，
/// 会话里连着的 EP 不会因为改了偏好而改变。
fn cache_key(model_id: &str, backend: Backend) -> String {
    format!("{}::{:?}", model_id, backend)
}

/// `id + backend -> 该会话的独占访问器`
///
/// 为什么要 `Arc<Mutex<Session>>` 而不是直接存 `Session`/`&mut Session`：
/// `Session::run` 签名是 `&mut self`，而把 `&mut` 存进 map 再借出来
/// 会跟「守卫持有 map 锁」直接冲突（E0505）。存可克隆的句柄最省事。
fn session_cache() -> &'static Mutex<HashMap<String, Arc<Mutex<Session>>>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Arc<Mutex<Session>>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 模型文件在数据目录下的位置：`models/{id}.onnx`
pub fn model_path(data_root: &std::path::Path, model: &UpscaleModel) -> PathBuf {
    data_root.join("models").join(model.file_name())
}

/// 持有一个模型会话的独占访问权。
///
/// 守卫活着期间，同一个模型的其他推理请求会阻塞等待——
/// 这不是妥协，而是 ONNX Runtime 的硬约束（`Session` 不可并发 `run`）。
pub struct SessionGuard {
    session: Arc<Mutex<Session>>,
    /// 实际生效的后端（请求 GPU 但注册失败时会是 CPU）
    backend: Backend,
}

impl SessionGuard {
    /// 拿到底层会话（加锁）
    pub fn session(&self) -> Result<std::sync::MutexGuard<'_, Session>, String> {
        self.session
            .lock()
            .map_err(|_| "超分会话已损坏，请重启应用".to_string())
    }

    /// 本次实际使用的后端
    pub fn backend(&self) -> Backend {
        self.backend
    }
}

/** 用指定后端建一个会话（不走缓存） */
fn build_session(file: &Path, prefer_gpu: bool) -> Result<(Arc<Mutex<Session>>, Backend), String> {
    // GPU 是**可选增强**而非前提：注册失败就静默回退 CPU，
    // 理由见 ep.rs 的模块文档。回退时会 eprintln 让调试日志能查到。
    let mut backend = Backend::Cpu;
    let mut builder = if prefer_gpu {
        let (next, err) = super::ep::apply_directml(super::ep::build_plain()?);
        match err {
            None => {
                backend = Backend::DirectML;
                next
            }
            // apply_directml 失败时已经把一个纯 CPU 的 builder 一并还回来了
            Some(reason) => {
                eprintln!("[upscale] GPU 加速不可用，已回退 CPU：{reason}");
                next
            }
        }
    } else {
        super::ep::build_plain()?
    };

    // CPU 路径才需要设线程数：GPU 路径由 DirectML 自己管线程，
    // 设了也没有意义（而且可能与 D3D 的线程池打架）。
    if backend == Backend::Cpu {
        builder = builder
            .with_intra_threads(intra_threads())
            .map_err(|e| format!("配置推理线程数失败：{e}"))?;
    }

    let built = builder.commit_from_file(file).map_err(|e| {
        format!("加载模型文件失败：{e}（文件可能下载不完整，可在设置页 · 超分 里重新下载）")
    })?;

    Ok((Arc::new(Mutex::new(built)), backend))
}

/// 拿到一个可用于推理的会话守卫，必要时从磁盘加载并缓存。
///
/// 模型文件不存在时**不自动下载**：下载动辄十几 MB，是用户明确的操作，
/// 悄悄拉只是浪费带宽。要下载请走 [`crate::upscale::commands::download_model`]。
///
/// `prefer_gpu` 为真时优先 DirectML，失败自动回退 CPU（见 [`build_session`]）。
pub fn acquire(
    model: &UpscaleModel,
    file: &Path,
    prefer_gpu: bool,
) -> Result<SessionGuard, String> {
    // 先按「想要的」算 key 查一次；没有再按实际后端算一次
    // （回退后建出来的会话必须记在 CPU 那个 key 下，否则下次又白建一个）
    let wanted = if prefer_gpu {
        Backend::DirectML
    } else {
        Backend::Cpu
    };
    if let Some(session) = lookup(&cache_key(model.id, wanted), wanted) {
        return Ok(session);
    }

    if !file.exists() {
        return Err(format!(
            "尚未下载模型「{}」，请先在设置页 · 超分 里下载",
            model.label
        ));
    }

    let (session, backend) = build_session(file, prefer_gpu)?;
    let key = cache_key(model.id, backend);

    let mut cache = session_cache()
        .lock()
        .map_err(|_| "超分会话缓存已损坏，请重启应用".to_string())?;
    // 另一个请求可能已经建好了同一个（单会话 + 持锁期间不会重复建）
    if let Some(existing) = cache.get(&key) {
        return Ok(SessionGuard {
            session: Arc::clone(existing),
            backend,
        });
    }
    cache.insert(key, Arc::clone(&session));
    Ok(SessionGuard { session, backend })
}

/// 查缓存（内部用：容忍锁失败）。
///
/// 后端由调用方显式传入——**不要靠 `key.ends_with("DirectML")` 反推**：
/// 那是靠字符串猜状态，模型 id 里出现同样字样就会误判。
fn lookup(key: &str, backend: Backend) -> Option<SessionGuard> {
    let cache = session_cache().lock().ok()?;
    cache.get(key).map(|s| SessionGuard {
        session: Arc::clone(s),
        backend,
    })
}

/**
 * 推理线程数。
 *
 * 实测（12 核机器，单块 256×256 推理）：
 * | 线程 | 每块耗时 | 1024×1024（25 块） |
 * |------|---------|---------------------|
 * | 1    | 6.8 s   | 171 s |
 * | 2    | 4.8 s   | 120 s |
 * | 4    | 3.3 s   | 82 s  |
 * | 8    | 2.3 s   | 59 s  |
 * | 12   | 2.2 s   | 55 s  |
 * | 16   | 2.2 s   | 55 s  |
 *
 * **不设的话 ONNX Runtime 自己拿不到好配置**（实测默认 2.85s/块，
 * 比显式 16 线程慢 30%），所以这里要显式给。
 * 超过 16 实测没有额外收益（12 核机器上 16 已饱和），但对更多核的机器有意义，
 * 因此按核心数封顶 16。
 */
fn intra_threads() -> usize {
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    cores.clamp(1, 16)
}

/**
 * 丢弃某个模型的缓存会话。
 *
 * 用于「重新下载模型」与「删除模型」：磁盘上的文件变了，
 * 内存里那个会话还持有旧图，用户会看到「下载成功了但推理结果没变」，
 * 更糟的是坏文件会导致每次推理都失败而看不出真正原因。
 *
 * 注意只从 map 里摘掉句柄：正在跑的推理（持有 Arc）不受影响，会跑完。
 *
 * **要清该模型的两个后端**——key 里带了后端后缀，
 * 只清一个会留下另一个继续被复用（换模型文件后拿到旧会话）。
 */
pub fn forget_session(id: &str) {
    if let Ok(mut cache) = session_cache().lock() {
        let keys: Vec<String> = cache
            .keys()
            .filter(|k| k.starts_with(id) && k.contains("::"))
            .cloned()
            .collect();
        for key in keys {
            cache.remove(&key);
        }
    }
}

/**
 * 从多个候选地址依次尝试下载模型。
 *
 * 逐个退避而不是并发：这些源体积都是几十 MB，并发只会互相挤带宽。
 * 写 `.part` 临时文件再改名，避免中途中断留下一个「看起来存在」的坏文件——
 * 那种坏文件会让后续每次推理都失败，但报错很难指向真正原因。
 */
pub async fn download_to(model: &UpscaleModel, dest: &PathBuf) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建模型目录失败：{e}"))?;
    }
    let temp = dest.with_extension("onnx.part");
    // 上一次中断可能留下半个 .part，先清掉
    let _ = std::fs::remove_file(&temp);

    let client = shared_client()?;
    let mut errors: Vec<String> = Vec::new();

    for url in model.urls {
        match fetch_once(client, url, &temp, model.size_bytes).await {
            Ok(()) => {
                std::fs::rename(&temp, dest).map_err(|e| format!("保存模型文件失败：{e}"))?;
                return Ok(());
            }
            Err(err) => errors.push(format!("{} → {err}", host_of(url))),
        }
    }

    let _ = std::fs::remove_file(&temp);
    Err(format!(
        "模型下载失败（已尝试 {} 个来源）：\n{}",
        errors.len(),
        errors.join("\n")
    ))
}

/// 下载单个来源。
///
/// 走 `http` 域的共享客户端：连接池与 TLS 会话得以复用，
/// 这跟项目里「出网只走 http 域」是同一条规矩。
async fn fetch_once(
    client: &reqwest::Client,
    url: &str,
    temp: &std::path::Path,
    expect: u64,
) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;

    // 超时给足：镜像首字节慢是常态，30s 容易误杀正常下载
    let mut response = client
        .get(url)
        .timeout(std::time::Duration::from_secs(900))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status().as_u16()));
    }

    // 服务端可能给的是 chunked 传输（拿不到 Content-Length），
    // 这种情况下 size_bytes 只是提示，不能当校验依据
    let declared = response.content_length().map(|v| v as u64);
    if let Some(len) = declared {
        if expect > 0 && len.abs_diff(expect) > 1024 * 1024 {
            return Err(format!(
                "文件大小异常（{:.1}MB，预期 {:.1}MB）",
                len as f64 / 1048576.0,
                expect as f64 / 1048576.0
            ));
        }
    }

    let mut file = tokio::fs::File::create(temp)
        .await
        .map_err(|e| e.to_string())?;
    loop {
        let n = response
            .chunk()
            .await
            .map_err(|e| format!("读取响应失败：{e}"))?
            .unwrap_or_default();
        if n.is_empty() {
            break;
        }
        file.write_all(&n).await.map_err(|e| e.to_string())?;
    }
    file.flush()
        .await
        .map_err(|e| format!("写入模型文件失败：{e}"))?;
    drop(file);

    let actual = std::fs::metadata(temp).map(|m| m.len()).unwrap_or(0);
    if actual == 0 {
        return Err("下载内容为空".to_string());
    }
    // 只做「明显不完整」判断：1MB 以内的偏差不追究（不同镜像的打包方式可能略有出入）
    if expect > 0 && actual + 1024 * 1024 < expect {
        return Err(format!(
            "下载不完整（{:.1}MB / {:.1}MB）",
            actual as f64 / 1048576.0,
            expect as f64 / 1048576.0
        ));
    }
    Ok(())
}

/// 从 URL 里取 host，用于错误文案
fn host_of(url: &str) -> String {
    url.split("://")
        .nth(1)
        .and_then(|rest| rest.split('/').next())
        .unwrap_or(url)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn value_range_roundtrips_through_encode_decode() {
        for range in [ValueRange::ZeroOne, ValueRange::MinusOneOne] {
            for v in [0u8, 1, 128, 254, 255] {
                let back = range.decode(range.encode(v));
                assert!(
                    (back as i32 - v as i32).abs() <= 1,
                    "{range:?} 往返失真：{v} → {back}"
                );
            }
        }
    }

    #[test]
    fn decode_clamps_out_of_range_output() {
        // GAN 输出无界，不夹会 wrap 成花屏
        assert_eq!(ValueRange::ZeroOne.decode(-3.0), 0);
        assert_eq!(ValueRange::ZeroOne.decode(4.2), 255);
        assert_eq!(ValueRange::MinusOneOne.decode(-2.0), 0);
        assert_eq!(ValueRange::MinusOneOne.decode(2.0), 255);
    }

    #[test]
    fn every_model_has_consistent_registry_entry() {
        for model in MODELS {
            assert!(model.scale >= 2, "{} 的倍数不合理", model.label);
            assert!(
                model.size_bytes > 1024 * 1024,
                "{} 的体积信息缺失，无法在下载前提示用户",
                model.label
            );
            assert!(!model.urls.is_empty(), "{} 没有下载地址", model.label);
        }
    }

    #[test]
    fn default_model_is_resolvable() {
        assert!(find(default_model_id()).is_ok());
        assert!(find("不存在的模型").is_err());
    }

    #[test]
    fn intra_threads_is_bounded_and_sane() {
        // 实测超过 16 线程没有额外收益，但更少核心的机器要能正确取到实际值。
        // 上下界写死在这里，是为了防止有人把它改成硬编码或去掉。
        let n = intra_threads();
        assert!((1..=16).contains(&n), "线程数越界：{n}");
    }

    #[test]
    fn default_model_is_verified_to_preserve_colour() {
        // **回归测试：别再把去饱和的模型设成默认。**
        //
        // 历史教训：默认模型曾是 `realesrgan-x4-int8`（PBR 贴图专用导出版），
        // 契约完美但实测把纯红 (255,0,0) 输出成 R=82.5 G=82.4 B=81.9 的纯灰。
        // 用户反馈「颜色相差较大」，而当时我只验了契约没验彩度。
        //
        // 验收标准：喂彩度拉满的纯 RGB 色块，输出三通道必须仍明显不同。
        // 下面只做**元信息层面的门禁**（不跑推理，太慢），真正跑模型的验收
        // 在 `probes/upscale_model_probe` 那类工具里做，发现问题就回来改这里。
        let def = find(default_model_id()).expect("默认模型必须存在");
        assert!(
            !def.note.contains("去饱和"),
            "默认模型被标记为去饱和：{}（{}）",
            def.label,
            def.note
        );
    }

    #[test]
    fn known_desaturated_model_is_not_recommended() {
        // PBR 贴图专用的那个必须保留（纹理图放大仍有价值），
        // 但 note 里必须写明它去饱和——否则用户会以为是通用模型。
        let legacy = find("realesrgan-x4-int8").expect("旧模型应保留在注册表里");
        assert!(
            legacy.note.contains("去饱和"),
            "旧模型的 note 必须警告去饱和，实际：{}",
            legacy.note
        );
    }

    #[test]
    fn every_model_declares_multiple_download_sources() {
        // 国内直连 huggingface.co 常常超时/502，镜像必须排在前面。
        for m in MODELS {
            assert!(m.urls.len() >= 2, "{} 只有一个下载源，镜像兜底没了", m.id);
            assert!(
                m.urls[0].contains("hf-mirror.com"),
                "{} 的首个源应是镜像（国内优先），实际 {}",
                m.id,
                m.urls[0]
            );
        }
    }
}

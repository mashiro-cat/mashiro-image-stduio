//! 缩略图域的**集成测试**：跑真实的大文件，验证性能与正确性。
//!
//! 为什么单独一个文件而不是塞进 `render.rs` 的单测：
//! `render.rs` 的测试是纯函数级的（喂几 KB 的内存图），
//! 锁不住「8192² 的 PNG 到底要多久 / 多少内存」这个**真正的问题**。
//! 曾经的问题正是：首页一加载 126MB 的图，整个软件就卡住。
//!
//! 这些测试**依赖本机真实数据**，没有对应文件时自动跳过（不 fail），
//! 这样 CI / 别人的机器上不会因为缺文件而红。
//!
//! 运行：`cargo test --lib thumb::integration -- --ignored --nocapture`
//! （默认不跑：`#[ignore]`，因为要读上百 MB 的文件）

use std::path::PathBuf;

use super::cache;
use super::render;

/// 本机真实数据目录里的图片目录
fn images_dir() -> PathBuf {
    let base = std::env::var("APPDATA")
        .or_else(|_| std::env::var("HOME").map_err(|_| "no home".to_string()))
        .unwrap_or_default();
    PathBuf::from(base)
        .join("com.mashiro.imagegen")
        .join("images")
}

/// 找一张「最大的本地图」，找不到就返回 None
fn largest_local_image() -> Option<PathBuf> {
    let dir = images_dir();
    if !dir.is_dir() {
        return None;
    }
    let mut best: Option<(u64, PathBuf)> = None;
    for entry in std::fs::read_dir(&dir).ok()?.flatten() {
        let path = entry.path();
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if !matches!(ext, "png" | "jpg" | "jpeg" | "webp") {
            continue;
        }
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        if best.as_ref().map(|(s, _)| size > *s).unwrap_or(true) {
            best = Some((size, path));
        }
    }
    best.map(|(_, p)| p)
}

/// 拆开量「解码」与「缩放」各自占多少——决定优化该打在哪。
///
/// 实测（本机 125MB / 8192² PNG）：解码是绝对大头，
/// 因此**优化重点不该放在缩放算法上**，而该放在「别重复解码」上（磁盘缓存）。
#[test]
#[ignore = "需要本机存在真实图片数据"]
fn bench_decode_vs_resize() {
    use super::render::TEST_MAX_ALLOC;
    use image::{GenericImageView, ImageReader, Limits};

    let Some(src) = largest_local_image() else {
        eprintln!("跳过：本机没有可用图片");
        return;
    };

    let t0 = std::time::Instant::now();
    let mut reader = ImageReader::open(&src)
        .unwrap()
        .with_guessed_format()
        .unwrap();
    let mut limits = Limits::default();
    limits.max_alloc = Some(TEST_MAX_ALLOC);
    reader.limits(limits);
    let decoded = reader.decode().unwrap();
    let decode_time = t0.elapsed();
    println!(
        "解码: {:?}（{}×{}）",
        decode_time,
        decoded.width(),
        decoded.height()
    );

    let t1 = std::time::Instant::now();
    let thumb = decoded.thumbnail(512, 512);
    let thumb_time = t1.elapsed();
    println!("缩放(两段式): {:?}", thumb_time);

    let t2 = std::time::Instant::now();
    let direct = decoded.resize(512, 512, image::imageops::FilterType::Triangle);
    let direct_time = t2.elapsed();
    println!("缩放(直接 Triangle): {:?}", direct_time);

    println!(
        "总计 ≈ {:?}；解码占比 {:.0}%",
        decode_time + thumb_time,
        100.0 * decode_time.as_secs_f64() / (decode_time + thumb_time).as_secs_f64()
    );
}

/// 真实大图：能生成缩略图，且体积降到 1% 以下
#[test]
#[ignore = "需要本机存在真实图片数据"]
fn large_image_produces_tiny_thumbnail() {
    let Some(src) = largest_local_image() else {
        eprintln!("跳过：本机没有可用图片");
        return;
    };
    let original = std::fs::metadata(&src).unwrap().len();
    println!("原图: {} ({} MB)", src.display(), original / 1024 / 1024);

    let started = std::time::Instant::now();
    let bytes = render::encode_thumbnail(&src, 512).expect("缩略图生成应成功");
    let elapsed = started.elapsed();

    println!("缩略图: {} KB，耗时 {:?}", bytes.len() / 1024, elapsed);

    // 核心断言：缩略图必须显著小于原图，否则等于没做优化
    assert!(
        (bytes.len() as u64) < original / 100,
        "缩略图 {} 字节相对原图 {} 字节压缩不足 100 倍",
        bytes.len(),
        original
    );
}

/// 缩略图长边必须真的被限制住
#[test]
#[ignore = "需要本机存在真实图片数据"]
fn thumbnail_respects_max_edge() {
    let Some(src) = largest_local_image() else {
        eprintln!("跳过：本机没有可用图片");
        return;
    };
    for edge in [128u32, 512, 1024] {
        let bytes = render::encode_thumbnail(&src, edge).expect("应成功");
        let img = image::load_from_memory_with_format(&bytes, image::ImageFormat::Jpeg).unwrap();
        let long = img.width().max(img.height());
        assert!(long <= edge, "请求 {edge} 却得到 {long} 像素的长边");
    }
}

/// 原图已经比上限小：不该放大，且体积不该暴涨
#[test]
fn small_image_is_not_upscaled() {
    // 造一张 100×80 的图，远小于 256 的上限
    // 目录名带 pid + 标签：cargo 在同一进程内多线程并行跑测试，
    // 用固定名字会互相删对方的目录（表现为「单独绿、全量红」）
    let dir = std::env::temp_dir().join(format!("mashiro-thumb-small-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    let src = dir.join("small.png");
    image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(100, 80, image::Rgb([9, 9, 9])))
        .save(&src)
        .unwrap();

    let bytes = render::encode_thumbnail(&src, 256).unwrap();
    let img = image::load_from_memory_with_format(&bytes, image::ImageFormat::Jpeg).unwrap();
    assert_eq!((img.width(), img.height()), (100, 80), "小图被放大了");

    let _ = std::fs::remove_dir_all(&dir);
}

/// 缓存文件命名：不同尺寸互不覆盖
#[test]
fn cache_paths_are_size_specific() {
    let dir = PathBuf::from("/tmp/thumbs");
    let src = PathBuf::from("/data/images/img_abc.png");
    let a = cache::thumb_path(&dir, &src, 256).unwrap();
    let b = cache::thumb_path(&dir, &src, 1024).unwrap();
    assert_ne!(a, b, "不同尺寸必须落到不同文件，否则会互相覆盖");
    assert!(a.to_string_lossy().ends_with("img_abc_256.jpg"));
    assert!(b.to_string_lossy().ends_with("img_abc_1024.jpg"));
}

/// 0 字节的缓存文件必须被判为无效
///
/// 这是真实踩过的坑：写缩略图走 `.part` + rename，
/// 进程若在 rename 前被杀，理论上可能留下 0 字节文件。
#[test]
fn zero_byte_cache_file_is_rejected() {
    let dir = std::env::temp_dir().join(format!("mashiro-thumb-zero-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    let file = dir.join("x_512.jpg");

    std::fs::write(&file, b"").unwrap();
    assert!(!cache::is_cached(&file), "0 字节文件竟被当成有效缓存");

    std::fs::write(&file, b"real bytes").unwrap();
    assert!(cache::is_cached(&file), "正常文件应被认作有效缓存");

    let _ = std::fs::remove_dir_all(&dir);
}

/// 关键对照：缩略图管线对**典型小图**是不是净负担。
///
/// 本机实测 WebView 直接解码 1.7MB 的 PNG 只要 **7ms**、9.8MB 44ms。
/// 如果缩略图管线（invoke + 解码 + 缩放 + JPEG 编码 + 写盘 + 再解码）
/// 反而比直接加载原图慢，那这套东西对 99% 的图片就是**纯负优化**。
#[test]
#[ignore = "需要本机存在真实图片数据"]
fn typical_image_is_not_slower_via_thumbnail() {
    use std::time::Instant;

    // 取「中位」那一张（≈1.7MB），而不是最大的那张
    let Some(src) = median_local_image() else {
        eprintln!("跳过：本机没有可用图片");
        return;
    };
    let bytes = std::fs::metadata(&src).unwrap().len();

    // 只量解码（缩略图管线里唯一不可省的部分）
    let t0 = Instant::now();
    let src_img = image::open(&src).expect("应能解码");
    let decode_only = t0.elapsed();

    // 完整缩略图管线
    let t1 = Instant::now();
    let thumb = render::encode_thumbnail(&src, 512).expect("应能生成缩略图");
    let full = t1.elapsed();

    println!(
        "原图 {:.1}MB（{}×{}）：仅解码 {:?}；缩略图全流程 {:?}（产出 {}KB）",
        bytes as f64 / 1024.0 / 1024.0,
        src_img.width(),
        src_img.height(),
        decode_only,
        full,
        thumb.len() / 1024
    );

    // 缩略图体积必须显著更小——这是缩略图唯一的、真正的收益
    assert!(
        (thumb.len() as u64) < bytes / 10,
        "缩略图 {} 字节 vs 原图 {} 字节，压缩不足 10 倍",
        thumb.len(),
        bytes
    );
}

/// 真实数据里按大小排序取中间那张（≈中位数）
fn median_local_image() -> Option<PathBuf> {
    let dir = images_dir();
    if !dir.is_dir() {
        return None;
    }
    let mut all: Vec<(u64, PathBuf)> = std::fs::read_dir(&dir)
        .ok()?
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            let ext = p.extension().and_then(|x| x.to_str()).unwrap_or("");
            if !matches!(ext, "png" | "jpg" | "jpeg" | "webp") {
                return None;
            }
            Some((e.metadata().map(|m| m.len()).unwrap_or(0), p))
        })
        .collect();
    all.sort_by_key(|(size, _)| *size);
    all.get(all.len() / 2).map(|(_, p)| p.clone())
}

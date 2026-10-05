//! 解码 → 缩放 → 编码。纯计算，不碰路径。
//!
//! 分出去单独一个文件是为了让 [`crate::thumb::cache`] 只管「放哪」，
//! 这里的算法细节（滤镜、alpha 铺底、编码质量）不会把缓存逻辑冲散。

use std::path::Path;

use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, ImageReader, Limits, Rgb, RgbImage};

/// JPEG 质量。
///
/// 82 是肉眼几乎无损的档位，也是缩略图体积的主要决定因素：
/// 512px 的图在 82 下典型 20~60KB，而 WebP/PNG 拦不住「一张缩略图也不小」。
/// 再往上（95+）体积翻倍，列表里根本看不出差别。
const QUALITY: u8 = 82;

// 解码内存上限（字节）。
//
// **必须 ≥ 8192² 的 RGBA 位图（8192×8192×4 = 256MiB）**，否则本域存在的理由
// 就没有了——超分产物恰好就是 8192²，限额卡在这里会让最大的那几张图
// 直接生成失败、悄悄回退成加载原图（也就是退回卡顿）。
// 取 320MiB：留一点余量给解码器自身的临时缓冲。
//
// 代价是最坏情况单张占 320MB，因此 [`super::MAX_CONCURRENT`] 必须保持 2。
const MAX_ALLOC: u64 = 320 * 1024 * 1024;

/// 仅测试可见：让集成测试用同一套限额，别写出magic number
#[cfg(test)]
pub(crate) const TEST_MAX_ALLOC: u64 = MAX_ALLOC;

// 读原图并缩到长边不超过 `max_edge`，返回 JPEG 字节。
//
// `max_edge` 是**长边上限**，短边按原比例缩放——竖图不会因为限制长边而被压成横的。
//
// # 为什么用 `resize` 而不是 `thumbnail`
//
// `thumbnail` 是「每个源像素只贡献给一个目标像素」的快速整数算法，
// 从 8192² 缩到 512 是 16:1 的抽样，会丢掉 15/16 的像素并产生明显摩尔纹。
// `resize` + `Triangle` 走可分离卷积，做真正的面积平均，大比例缩小才不出锯齿。
// 代价是慢一些，但这是在限并发的后台线程里跑的，且结果永久缓存。
pub(crate) fn encode_thumbnail(source: &Path, max_edge: u32) -> Result<Vec<u8>, String> {
    let decoded = decode(source)?;
    let thumb = fit(&decoded, max_edge);
    let flat = flatten(thumb);
    encode_jpeg(&flat)
}

/// 打开并解码，套上内存上限。
fn decode(source: &Path) -> Result<DynamicImage, String> {
    let mut reader = ImageReader::open(source)
        .map_err(|e| format!("无法读取图片：{e}"))?
        .with_guessed_format()
        .map_err(|e| format!("无法识别图片格式：{e}"))?;
    let mut limits = Limits::default();
    limits.max_alloc = Some(MAX_ALLOC);
    reader.limits(limits);
    reader
        .decode()
        .map_err(|e| format!("解码图片失败：{e}（图片可能已损坏或尺寸异常）"))
}

// 等比缩到长边 ≤ `max_edge`；已经够小就原样返回（不做无谓的重采样）
//
// # 为什么是两段式，而不是直接 resize(FilterType::Triangle)
//
// 直接卷积的代价与**源像素数**成正比。8192² → 512 是 16:1 的大比例缩小，
// 此时对 6700 万个源像素跑一遍 Triangle 卷积纯属浪费——本机实测：
//
// - 解码 8192² PNG：**3.1s**
// - 直接 `resize(512, Triangle)`：**10.5s**（解码的 3.4 倍，瓶颈全在这）
// - 两段式（`thumbnail` 快速整数降到 2 倍，再 Triangle 收尾）：**4.5s**
//
// 做法是先 `thumbnail`（每源像素只贡献给一个目标像素）降到 2 倍边长，
// 再对已经很小的图做卷积收尾。**快 2.4 倍，且抗锯齿质量不降**——
// 整数抽样已经抹掉了 15/16 的高频，最后一步 Triangle 只需处理剩下的混叠。
fn fit(image: &DynamicImage, max_edge: u32) -> DynamicImage {
    let long = image.width().max(image.height());
    if long <= max_edge {
        return image.clone();
    }
    // max_edge 上限是 2048（见 MAX_EDGE_LIMIT），×2 不会溢出
    let halved = image.thumbnail(max_edge * 2, max_edge * 2);
    halved.resize(max_edge, max_edge, FilterType::Triangle)
}

/**
 * 铺白底再转 RGB。
 *
 * JPEG 没有透明通道，`to_rgb8()` 那种「直接丢 alpha」的做法
 * 会让 PNG 的透明区域变成黑色（存的是 0,0,0），
 * 深色界面上一片死黑很难看。这里显式按 alpha 合成到白底——
 * 与 `platform/media.ts` 的 `downscaleForVision` 保持一致。
 */
fn flatten(image: DynamicImage) -> RgbImage {
    if !image.color().has_alpha() {
        return image.to_rgb8();
    }
    let rgba = image.to_rgba8();
    let (w, h) = rgba.dimensions();
    let mut base = RgbImage::from_pixel(w, h, Rgb([255, 255, 255]));
    for (x, y, px) in rgba.enumerate_pixels() {
        let [r, g, b, a] = px.0;
        // 按 alpha 做整数混合：a/255 的浮点运算在每像素上没必要
        let a = a as u32;
        let inv = 255 - a;
        base.put_pixel(
            x,
            y,
            Rgb([
                ((r as u32 * a + 255 * inv) / 255) as u8,
                ((g as u32 * a + 255 * inv) / 255) as u8,
                ((b as u32 * a + 255 * inv) / 255) as u8,
            ]),
        );
    }
    base
}

/// 编码成 JPEG 字节
fn encode_jpeg(image: &RgbImage) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(64 * 1024);
    JpegEncoder::new_with_quality(&mut out, QUALITY)
        .encode_image(image)
        .map_err(|e| format!("缩略图编码失败：{e}"))?;
    if out.is_empty() {
        return Err("缩略图编码结果为空".to_string());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb, Rgba};

    fn sample(w: u32, h: u32) -> DynamicImage {
        // 左侧纯红、右侧半透明绿：同时覆盖「缩放」与「alpha 铺底」两条路径
        let mut buf = ImageBuffer::new(w, h);
        for (x, y, px) in buf.enumerate_pixels_mut() {
            *px = if x < w / 2 {
                Rgba([255, 0, 0, 255])
            } else {
                Rgba([0, 255, 0, 0])
            };
            let _ = y;
        }
        DynamicImage::ImageRgba8(buf)
    }

    #[test]
    fn fit_preserves_aspect_ratio() {
        let out = fit(&sample(4000, 2000), 512);
        assert_eq!(out.width(), 512);
        assert_eq!(out.height(), 256);
    }

    #[test]
    fn fit_keeps_small_images_untouched() {
        // 已经小于上限时不该重采样——否则每次请求都要重编码一遍
        let out = fit(&sample(300, 200), 512);
        assert_eq!((out.width(), out.height()), (300, 200));
    }

    #[test]
    fn fit_handles_portrait_by_long_edge() {
        // 竖图按长边缩，不能被压成横的
        let out = fit(&sample(2000, 4000), 512);
        assert_eq!(out.height(), 512);
        assert_eq!(out.width(), 256);
    }

    #[test]
    fn fit_two_stage_still_lands_exactly_on_target() {
        // 两段式缩放（thumbnail → Triangle）必须精确落在目标尺寸上。
        // 两段式容易出的错是中间那步取整没对齐，最后一步就差几像素。
        for (w, h) in [(8192u32, 8192u32), (4000, 3000), (3000, 4000), (1024, 999)] {
            let out = fit(&sample(w, h), 512);
            let long = out.width().max(out.height());
            assert_eq!(long, 512, "{w}×{h} 缩放后长边不是 512");
        }
    }

    #[test]
    fn fit_two_stage_preserves_aspect_ratio() {
        let out = fit(&sample(4000, 1000), 512);
        // 4:1 的极端长条，短边应等比缩到 128
        assert_eq!(out.width(), 512);
        assert_eq!(out.height(), 128);
    }

    #[test]
    fn flatten_composites_transparent_pixels_onto_white() {
        // 右半边是全透明（内部 RGB 是 0,0,0）。直接丢 alpha 会得到纯黑，
        // 铺白底后必须接近白色——否则深色界面上会出现难看的黑块。
        let flat = flatten(sample(8, 4));
        let right = flat.get_pixel(7, 2).0;
        assert!(
            right[0] > 240 && right[1] > 240 && right[2] > 240,
            "透明区未被铺成白底，实际 {right:?}"
        );
        // 左半边是不透明红，必须保持原样
        let left = flat.get_pixel(0, 2).0;
        assert!(
            left[0] > 240 && left[1] < 20,
            "不透明区被污染，实际 {left:?}"
        );
    }

    #[test]
    fn flatten_keeps_opaque_images_untouched() {
        // 不带透明通道的图必须逐像素原样保留，不能被铺白逻辑改动
        let mut buf = ImageBuffer::new(4, 4);
        for px in buf.pixels_mut() {
            *px = Rgb([10, 20, 30]);
        }
        let flat = flatten(DynamicImage::ImageRgb8(buf));
        assert_eq!(flat.get_pixel(0, 0).0, [10, 20, 30]);
        assert_eq!(flat.get_pixel(3, 3).0, [10, 20, 30]);
    }

    #[test]
    fn jpeg_roundtrip_produces_non_empty_bytes() {
        let bytes = encode_jpeg(&flatten(fit(&sample(64, 64), 32))).expect("编码应成功");
        assert!(!bytes.is_empty());
        // JPEG 魔数
        assert_eq!(&bytes[..2], &[0xFF, 0xD8]);
    }
}

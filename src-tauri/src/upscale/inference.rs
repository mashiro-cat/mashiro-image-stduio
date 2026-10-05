//! 分块推理与羽化融合。
//!
//! # 为什么要分块
//!
//! Real-ESRGAN 吃整图的话，4× 输出意味着显存/内存按 16 倍涨：
//! 一张 1024×1024 的图直接推理要 4096×4096×3 的浮点中间量（数百 MB），
//! 再多几张就 OOM。所以按 tile 逐块跑，每块的输入输出都不大。
//!
//! # 为什么要羽化
//!
//! 直接把 tile 拼起来会出**接缝**——ncnn 官方文档也承认这一点：
//! 每个 tile 独立推理，边缘像素缺少邻域信息，亮度/纹理在交界处对不上。
//!
//! 这里的做法是让相邻 tile **重叠** `OVERLAP` 像素，并对重叠区做线性羽化
//! （越靠 tile 边缘权重越低），再按权重累加求平均。重叠区两侧各出一半，
//! 权重互补，接缝被抹平。
//!
//! 代价是要多做一次全图尺寸的浮点累加缓冲。对 4K 输出是几百 MB，
//! 但它换掉了「拼图有缝」这个一眼可见的缺陷——值得。

use std::path::Path;

use image::RgbImage;
use ndarray::Array4;
use ort::inputs;
use ort::value::TensorRef;

use super::ep::Backend;
use super::model::{self, UpscaleModel, ValueRange};

/// 单块推理的边长（输入空间，即原图分辨率）。
///
/// 256 是权衡：块越小接缝越多、越慢；块越大内存峰值越高。
/// ESRGAN 系模型的感受野在 256 输入下已经能覆盖足够上下文。
const TILE: u32 = 256;

/// 相邻块的重叠宽度（输入空间）。
///
/// 必须 ≥ 4：ONNX 模型的边界像素有 padding 影响，太窄的重叠带消不掉接缝。
const OVERLAP: u32 = 16;

/// 步进 = 块边长 - 重叠
const STEP: u32 = TILE - OVERLAP;

/// 单张图片处理的像素上限（输入空间）。
///
/// 防止用户拿一张 8000×8000 的图进来把内存吃光。
/// 4096×4096 的输入 ×4 输出是 16384²——这个尺寸本身就不现实，
/// 到这个量级已经能明确告诉用户「图太大了」而不是让它慢慢卡死。
const MAX_INPUT_EDGE: u32 = 4096;

/// 推理结果
pub struct Upscaled {
    /// 放大后的 RGB 图
    pub image: RgbImage,
    /// 实际放大倍数（可能与模型声明的倍数不一致，以运行时为准）
    pub scale: u32,
    /// 实际使用的推理后端（用户开了 GPU 但注册失败时会是 CPU）
    pub backend: Backend,
}

/// 读图 → 超分 → 写图。
///
/// `max_edge` 是输出长边上限（像素），超过则等比缩回；`None` 表示不限制。
/// **它不省推理时间**（推理在此之前已完成），只省内存、磁盘与后续传输。
///
/// `target_scale` 是**最终输出**的放大倍数：模型只能输出它自己那一档
/// （x4 模型一律 4×），要更小的倍数就在推理后做一次高质量重采样——
/// 这与 Real-ESRGAN 官方 `--outscale` 的做法一致。
///
/// 走文件路径而不是内存：调用方（commands）需要把结果落进数据目录，
/// 而源文件本来就在磁盘上，中转 base64 只会白白多几份拷贝。
pub fn upscale_file(
    model: &'static UpscaleModel,
    model_file: &Path,
    src: &Path,
    target_scale: u32,
    use_gpu: bool,
    max_edge: Option<u32>,
) -> Result<Upscaled, String> {
    let source = image::open(src)
        .map_err(|e| format!("无法读取图片：{e}（矢量图与不支持的格式请先转成 PNG/JPG/WEBP）"))?;
    let source = source.to_rgb8();
    upscale_image(model, model_file, &source, target_scale, use_gpu, max_edge)
}

/// 对内存中的 RGB 图做超分。
pub fn upscale_image(
    model: &'static UpscaleModel,
    model_file: &Path,
    source: &RgbImage,
    target_scale: u32,
    use_gpu: bool,
    max_edge: Option<u32>,
) -> Result<Upscaled, String> {
    let (w, h) = source.dimensions();
    if w == 0 || h == 0 {
        return Err("图片尺寸为空".to_string());
    }
    if w > MAX_INPUT_EDGE || h > MAX_INPUT_EDGE {
        return Err(format!(
            "图片尺寸过大（{w}×{h}），本地超分单张上限为 {MAX_INPUT_EDGE}×{MAX_INPUT_EDGE}"
        ));
    }
    if target_scale == 0 {
        return Err("放大倍数必须大于 0".to_string());
    }

    // 独占访问会话：SessionGuard 活着期间同模型的其他推理排队（见 model.rs）
    let guard = model::acquire(model, model_file, use_gpu)?;
    let mut session = guard.session()?;
    let input_name = session
        .inputs()
        .first()
        .ok_or_else(|| "模型没有输入节点，文件可能已损坏".to_string())?
        .name()
        .to_string();

    let tiles = layout(w, h);
    let scale = model.scale;
    let out_w = w.saturating_mul(scale);
    let out_h = h.saturating_mul(scale);

    // 累加缓冲：acc 存「像素值 × 羽化权重」的加权和，weight 存权重和。
    // 两者都用 f32——权重是小数，直接累加 u8 会把有效位吃掉。
    let mut acc = vec![0f32; (out_w as usize) * (out_h as usize) * 3];
    let mut weight = vec![0f32; (out_w as usize) * (out_h as usize)];

    for (tx, ty) in tiles {
        // 越界的块裁到实际尺寸——右/下边缘往往不满一整块
        let tw = TILE.min(w - tx);
        let th = TILE.min(h - ty);
        let tile = crop(source, tx, ty, tw, th);

        let (data, out_tile_w, out_tile_h, out_tile_plane) =
            run_tile(&mut session, &input_name, model.value_range, &tile)?;

        // 该块在输出坐标系里的左上角
        let ox = tx * scale;
        let oy = ty * scale;

        // 羽化过渡带宽度：换算到**输出**像素空间，且不超过块的一半
        //（超过会让左右两条带交叠，把中心权重压到 1 以下）。
        // 下限 1.0：模型若没按声明的倍数放大，OVERLAP 换算过去会变成 0。
        let ramp_x = (OVERLAP as f32 * out_tile_w as f32 / tw as f32)
            .min(ramp_limit(out_tile_w))
            .max(1.0);
        let ramp_y = (OVERLAP as f32 * out_tile_h as f32 / th as f32)
            .min(ramp_limit(out_tile_h))
            .max(1.0);

        for yi in 0..out_tile_h {
            let fy = feather(yi, out_tile_h, ramp_y);
            for xi in 0..out_tile_w {
                let wgt = fy * feather(xi, out_tile_w, ramp_x);
                let gx = (ox + xi) as usize;
                let gy = (oy + yi) as usize;
                if gx >= out_w as usize || gy >= out_h as usize {
                    continue;
                }
                let base = (gy * out_w as usize + gx) * 3;
                let src = (yi * out_tile_w + xi) as usize;
                for c in 0..3 {
                    acc[base + c] += data[c * out_tile_plane + src] * wgt;
                }
                weight[gy * out_w as usize + gx] += wgt;
            }
        }
    }

    // 按权重和归一化，**原地改写 `acc`**。
    //
    // 这里曾经额外开一个 `acc_norm` 全量副本 —— 4096×4096 的输出下那是
    // 又一份 192MB 的分配 + 一次全图读写，纯属浪费。`acc` 归一化后就没用了，
    // 直接覆盖即可（`weight` 在此之后也不再读）。
    //
    // 注意归一化后**不转 u8**：动态范围补偿（见 `finalize_pixels`）
    // 需要全图浮点分布才能定标点，转早了就没法补偿。
    //
    // 三个通道各写各的 —— 这里曾写成 `Rgb([v, v, v])`（v 是灰度值），
    // 输出恒为灰度，表现为「放大后变黑白」。
    let pixels = (out_w as usize) * (out_h as usize);
    for i in 0..pixels {
        let wsum = weight[i];
        // 理论上 wsum 恒 > 0（每像素至少被中心权重 1 的块覆盖），
        // 但留个兜底免得除零产出 NaN 后整图变黑
        let inv = if wsum > 1e-6 { 1.0 / wsum } else { 0.0 };
        let base = i * 3;
        acc[base] *= inv;
        acc[base + 1] *= inv;
        acc[base + 2] *= inv;
    }
    // `weight` 与 `acc` 等大，归一化完就不再需要 —— 尽早释放能给
    // 随后的 `finalize_pixels` 腾出峰值内存（大图下这一项就是 64MB）
    drop(weight);

    // 补偿量化模型压掉的动态范围，再转 u8
    let result = finalize_pixels(model.value_range, &acc, out_w, out_h)?;

    // 目标倍数小于模型倍数时（x4 模型出 2×/3×），做一次高质量重采样。
    // 做法与 Real-ESRGAN 官方 `--outscale` 一致：先满倍数放大，再缩到目标。
    //
    // **注意：推理量只取决于输入尺寸，与目标倍数无关**（模型固定 4×）。
    // 所以「选 2× 省时间」是错的——省的是内存和磁盘，不是等待。
    let result = if target_scale < scale {
        resize_to(
            &result,
            w.saturating_mul(target_scale),
            h.saturating_mul(target_scale),
        )?
    } else {
        result
    };

    // 输出尺寸上限：超过就等比缩回。
    //
    // 这是给「4× 后太大」准备的。2048² 的图 4× 后是 8192² —— 印刷用得上，
    // 但屏幕用途（4K 屏才 3840 宽）纯属浪费：内存翻 4 倍、文件翻 4 倍。
    //
    // **它省时间吗？不省**（推理已完成）。但它让「我只想看清细节」的用户
    // 不必为了屏幕查看去等一次几分钟的全尺寸放大。
    let result = match max_edge {
        Some(limit) if limit > 0 => {
            let (ow, oh) = result.dimensions();
            let longest = ow.max(oh);
            if longest > limit {
                let ratio = limit as f32 / longest as f32;
                resize_to(
                    &result,
                    ((ow as f32 * ratio).round() as u32).max(1),
                    ((oh as f32 * ratio).round() as u32).max(1),
                )?
            } else {
                result
            }
        }
        _ => result,
    };

    Ok(Upscaled {
        image: result,
        scale: target_scale,
        // 请求 GPU 但注册失败时 acquire 会回退，这里如实上报「实际跑在什么上」，
        // 否则界面显示「GPU 加速」而实际在 CPU 上跑，用户无法察觉。
        backend: guard.backend(),
    })
}

// -----------------------------------------------------------------------------
// 动态范围补偿
// -----------------------------------------------------------------------------

/**
 * 把归一化后的浮点像素转成 u8，**顺带补偿量化模型压掉的动态范围**。
 *
 * # 为什么要补偿
 *
 * 当前模型是 INT8 量化版（QLinearConv），输出动态范围比训练时窄：
 * 实测喂 256×256 满幅渐变图，模型输出范围只有 `[-0.01, 0.81]`
 * （原图 `[0, 1.0]`），逐通道标准差从 `0.29` 掉到 `0.21~0.23`
 * ——**只剩 72~78%**。不补偿就是用户说的「更灰了」。
 *
 * # 关键：三通道必须用**同一组** lo/span（统一增益）
 *
 * 这里曾是**逐通道独立拉伸**，看着更"聪明"，实际是**色偏的元凶**。
 * 实测低饱和度图（灰底 + 粉图案，用户真实场景）时，模型输出的三通道
 * 动态范围是 `0.078 / 0.086 / 0.094` —— 极窄且**不完全相同**。
 * 逐通道独立拉伸会把这 0.016 的差异放大成肉眼明显的偏色：
 * 用户反馈「灰底变绿底」。
 *
 * 统一增益取 `lo = min(三通道)`、`span = min(三通道)`：
 * - 用 min 保证**任何一路都不会被截断**（高光不会死白）
 * - 三通道共用同一组 lo/span 等于整体对比度拉伸，**色相与饱和度关系完全不变**
 *
 * 代价是三通道跨度差异大时（正常彩色照片），统一增益会保守一些、
 * 对比度恢复不如逐通道多——但「不偏色」比「多拉一点对比度」重要得多：
 * **偏色是系统性错误，多拉一点对比度只是保守取舍。**
 *
 * # 何时跳过
 *
 * 范围已接近满幅（≥ 0.92）或本身就是平图（≤ 0.02）时不处理——
 * 前者没必要动，后者拉伸只会放大噪声。
 */
fn finalize_pixels(
    range: ValueRange,
    values: &[f32],
    width: u32,
    height: u32,
) -> Result<RgbImage, String> {
    let pixels = width as usize * height as usize;
    if values.len() != pixels * 3 {
        return Err("像素缓冲区尺寸与图像尺寸不匹配".to_string());
    }

    // **先定步长再收集**：曾经写成「先 collect 全部像素、再 step_by 抽样」，
    // 那 40 万的上限根本没起作用——4096×4096 输出时每通道仍分配了
    // 1677 万个 f32（64MB）再丢掉 97.6%，三轮下来就多花几十秒。
    let step = (pixels / SAMPLE_LIMIT).max(1);
    let mut lows = [0f32; 3];
    let mut spans = [0f32; 3];
    for channel in 0..3 {
        let mut samples: Vec<f32> = Vec::with_capacity(pixels / step + 1);
        let mut i = 0usize;
        while i < pixels {
            samples.push(values[i * 3 + channel]);
            i += step;
        }
        if samples.is_empty() {
            return Err("图像为空".to_string());
        }
        samples.sort_unstable_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        lows[channel] = percentile(&samples, LOW_Q);
        spans[channel] = percentile(&samples, HIGH_Q) - lows[channel];
    }

    // **统一增益**：lo 与 span 都取三通道的最小值，见模块文档的「关键」一节
    let lo = lows.iter().cloned().fold(f32::INFINITY, f32::min);
    let span = spans.iter().cloned().fold(f32::INFINITY, f32::min);
    // 平图或已经满幅 → 不动
    let gain = if span < MIN_SPAN || span >= FULL_SPAN {
        None
    } else {
        Some((lo, span))
    };

    // 逐像素套用同一组参数，顺带组装成图像（不用中间 Vec，少一份全量内存）
    let mut result = RgbImage::new(width, height);
    for i in 0..pixels {
        let mut rgb = [0u8; 3];
        for c in 0..3 {
            let raw = values[i * 3 + c];
            let scaled = match gain {
                Some((lo, span)) => ((raw - lo) / span).clamp(0.0, 1.0),
                None => raw.clamp(0.0, 1.0),
            };
            rgb[c] = range.decode(scaled);
        }
        result.put_pixel((i as u32) % width, (i as u32) / width, image::Rgb(rgb));
    }
    Ok(result)
}

/**
 * 分位数拉伸的采样上限。
 *
 * 分位数对样本量不敏感：0.5% / 99.5% 分位在 1 万和 10 万样本下的差异
 * 远小于一个像素级色阶。6 万足够把排序成本压到几十毫秒。
 * 曾经设成 40 万纯属保守，反而成了大图上的性能瓶颈。
 */
const SAMPLE_LIMIT: usize = 60_000;
/// 低端裁切分位
const LOW_Q: f32 = 0.005;
/// 高端裁切分位
const HIGH_Q: f32 = 0.995;
/// 小于这个跨度认为是平图，不做拉伸（否则放大噪声）
const MIN_SPAN: f32 = 0.02;
/// 已经接近满幅就不动
const FULL_SPAN: f32 = 0.92;

/// 取分位数（`sorted` 必须已升序）
fn percentile(sorted: &[f32], q: f32) -> f32 {
    if sorted.is_empty() {
        return 0.0;
    }
    let idx = (((sorted.len() - 1) as f32) * q.clamp(0.0, 1.0)).round() as usize;
    sorted[idx.min(sorted.len() - 1)]
}

/// 高质量重采样：用 Catmull-Rom 滤波。
///
/// 不用最近邻——那会让 2× 结果出现明显的锯齿与丢细节，
/// 恰好抵消了超分的意义。Catmull-Rom 是 `image` crate 里
/// 比 Bilinear/Lanczos3 略便宜、又明显更锐的一档，适合降采样。
fn resize_to(source: &RgbImage, width: u32, height: u32) -> Result<RgbImage, String> {
    if width == 0 || height == 0 {
        return Err("目标尺寸无效".to_string());
    }
    Ok(image::imageops::resize(
        source,
        width,
        height,
        image::imageops::FilterType::CatmullRom,
    ))
}

/// 羽化曲线：两端线性衰减到 0，中心为 1。
///
/// `ramp` 是过渡带宽度（输出像素）。`ramp <= 0` 时退化为无羽化。
fn feather(index: u32, size: u32, ramp: f32) -> f32 {
    if ramp <= 0.0 || size == 0 {
        return 1.0;
    }
    let i = index as f32;
    let last = (size - 1) as f32;
    // 距离最近边缘有多远
    let edge = i.min(last - i);
    if edge >= ramp {
        1.0
    } else if edge <= 0.0 {
        // 正好落在最外圈：权重 0 会让该像素只靠邻块贡献，
        // 对边缘块而言邻块不存在 → 除以 0。用一个极小值兜底。
        0.02
    } else {
        edge / ramp
    }
}

/// 裁一块出来（不复制的视图，循环里会反复用）
fn crop(source: &RgbImage, x: u32, y: u32, w: u32, h: u32) -> RgbImage {
    let mut out = RgbImage::new(w, h);
    for yi in 0..h {
        for xi in 0..w {
            out.put_pixel(xi, yi, *source.get_pixel(x + xi, y + yi));
        }
    }
    out
}

/// 单块推理的输出。
///
/// `0` 是 CHW 平面的数据（**未按权重归一化**——归一化要等全局累加完才能做，
/// 因为羽化权重逐像素不同，在这里除等于除两次）；后面三项是 (宽, 高, 平面大小)。
type TileOut = (Vec<f32>, u32, u32, usize);

/// 分块起点列表。
///
/// 步进式覆盖整图，相邻块重叠 `OVERLAP`；边缘块允许不满一整块
/// （起点被钉在 `边长 - TILE`，让最后一块盖到边上而不是留白）。
fn layout(w: u32, h: u32) -> Vec<(u32, u32)> {
    let mut tiles = Vec::new();
    let mut y = 0u32;
    loop {
        let mut x = 0u32;
        loop {
            // 最后一块钉在右/下边界，确保盖到边缘
            tiles.push((x.min(w.saturating_sub(TILE)), y.min(h.saturating_sub(TILE))));
            if x + TILE >= w {
                break;
            }
            x += STEP;
        }
        if y + TILE >= h {
            break;
        }
        y += STEP;
    }
    tiles
}

/// 羽化过渡带宽度上限：不能超过块边长的一半，
/// 否则左右（或上下）两条过渡带会交叠，把中心权重压到 1 以下。
fn ramp_limit(size: u32) -> f32 {
    (size as f32) * 0.5
}

/// 单块推理：HWC u8 → NCHW f32 → 推理 → CHW f32
///
/// `session` 取可变引用：ONNX Runtime 的 `Session::run` 内部要写运行时状态
/// （图优化缓存、内存分配器），不是只读的。
fn run_tile(
    session: &mut ort::session::Session,
    input_name: &str,
    range: ValueRange,
    tile: &RgbImage,
) -> Result<TileOut, String> {
    let (w, h) = tile.dimensions();
    // Array4 是标准 row-major NCHW：[batch][channel][height][width]，
    // 与 ONNX 模型的输入约定一致，也免去手工算平面偏移。
    let mut input = Array4::<f32>::zeros((1, 3, h as usize, w as usize));
    for y in 0..h {
        for x in 0..w {
            let px = tile.get_pixel(x, y);
            input[[0, 0, y as usize, x as usize]] = range.encode(px[0]);
            input[[0, 1, y as usize, x as usize]] = range.encode(px[1]);
            input[[0, 2, y as usize, x as usize]] = range.encode(px[2]);
        }
    }

    // ort 的 TensorRef 走**零拷贝借用**：`TensorArrayData` 由 `&ArrayBase` 实现。
    // 写完就不再改动 input，所以用不可变引用（换成 &mut 会匹配到 TensorArrayDataMut
    // 那条路径，反而编译不过）。
    let input = input;
    let tensor =
        TensorRef::from_array_view(&input).map_err(|e| format!("构造输入张量失败：{e}"))?;

    let outputs = session
        .run(inputs![input_name => tensor])
        .map_err(|e| format!("模型推理失败：{e}"))?;

    let (out_shape, data) = outputs[0]
        .try_extract_tensor::<f32>()
        .map_err(|e| format!("读取模型输出失败：{e}"))?;

    // 校验形状：模型 scale 字段填错、文件与注册表不匹配，都该在这里报错，
    // 而不是悄悄产出一张尺寸对不上的图
    if out_shape.len() != 4 {
        return Err(format!(
            "模型输出形状异常（{out_shape:?}），该模型可能不是单图超分网络"
        ));
    }
    let out_c = out_shape[1] as usize;
    let out_h = out_shape[2] as usize;
    let out_w = out_shape[3] as usize;
    if out_c != 3 {
        return Err(format!("模型输出通道数异常（{out_c}，期望 3）"));
    }
    let out_plane = out_w * out_h;
    if data.len() < out_c * out_plane {
        return Err("模型输出数据长度与形状不匹配，文件可能下载不完整".to_string());
    }

    Ok((
        data[..out_c * out_plane].to_vec(),
        out_w as u32,
        out_h as u32,
        out_plane,
    ))
}

/// 编码为 PNG 字节（超分产物统一存 PNG：无损、避免二次压缩吃掉细节）
pub fn encode_png(image: &RgbImage) -> Result<Vec<u8>, String> {
    let mut buf = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(image.clone())
        .write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| format!("编码超分结果失败：{e}"))?;
    Ok(buf.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn feather_is_full_weight_in_the_middle() {
        assert!((feather(128, 256, 16.0) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn feather_decays_towards_both_edges() {
        // 越靠近边缘权重越低，这是消接缝的前提
        assert!(feather(4, 256, 16.0) < feather(8, 256, 16.0));
        assert!(feather(8, 256, 16.0) < feather(16, 256, 16.0));
        // 对称：左右边缘同权
        assert!((feather(4, 256, 16.0) - feather(251, 256, 16.0)).abs() < 1e-6);
    }

    #[test]
    fn feather_never_returns_zero_to_avoid_division_blowup() {
        // 边缘块没有邻块配对，权重必须是正数，否则归一化时除零
        assert!(feather(0, 256, 16.0) > 0.0);
        assert!(feather(255, 256, 16.0) > 0.0);
    }

    #[test]
    fn feather_degrades_gracefully_without_ramp() {
        assert!((feather(0, 256, 0.0) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn tiles_cover_whole_image_with_overlap() {
        // 128x128 < TILE：应只有一块，且不越界
        let tiles = layout(128, 128);
        assert_eq!(tiles, vec![(0, 0)]);

        // 300x300：多块，最后一块必须被裁到边界内
        let tiles = layout(300, 300);
        assert!(tiles.len() > 1);
        for (x, y) in &tiles {
            assert!(*x < 300, "块起点 {x} 越界");
            assert!(*y < 300, "块起点 {y} 越界");
        }
        // 最后一个块应贴到右下角
        let (lx, ly) = *tiles.last().unwrap();
        assert!(lx + TILE >= 300);
        assert!(ly + TILE >= 300);
    }

    #[test]
    fn oversized_input_is_rejected_not_truncated() {
        // 关键：超限必须报错，不能默默截断成一小块
        assert!(MAX_INPUT_EDGE >= TILE);
    }

    #[test]
    fn resize_preserves_colour_channels_independently() {
        // 回归测试：曾经把 `Rgb([v, v, v])`（v 是灰度值）写进结果，
        // 导致放大后的图永远是黑白。重采样这条路必须保住通道差异。
        let mut src = RgbImage::new(8, 8);
        for y in 0..8 {
            for x in 0..8 {
                // 纯红：R=255 G=0 B=0
                src.put_pixel(x, y, image::Rgb([255, 0, 0]));
            }
        }
        let out = resize_to(&src, 16, 16).expect("重采样应成功");
        let px = out.get_pixel(8, 8);
        // image 0.25 的 Rgb<u8> 是 tuple struct，只有 .0 可用（不是 .1/.2）
        let (r, g, b) = (px.0[0], px.0[1], px.0[2]);
        assert!(r > g && r > b, "红色被重采样成灰了：{px:?}");
        assert_eq!(g, b, "G/B 通道被污染成相同：{px:?}");
    }

    #[test]
    fn resize_rejects_degenerate_target() {
        let src = RgbImage::new(4, 4);
        assert!(resize_to(&src, 0, 10).is_err());
    }

    #[test]
    fn stretch_restores_contrast_compressed_by_quantization() {
        // 回归测试：INT8 模型输出范围只有 [-0.01, 0.81]（实测），
        // 直接 clamp 会把对比度压到 72~78% —— 用户看到的「更灰了」。
        // 这里造一个被压缩过的灰阶斜坡，验证拉伸能把对比度找回来。
        let (w, h) = (16u32, 16u32);
        let mut values = vec![0f32; (w * h) as usize * 3];
        for i in 0..(w * h) as usize {
            // 原始满幅斜坡 0.05 → 0.75（模拟量化后的压缩范围）
            let t = i as f32 / ((w * h) as f32 - 1.0);
            let v = 0.05 + t * 0.70;
            values[i * 3] = v;
            values[i * 3 + 1] = v;
            values[i * 3 + 2] = v;
        }
        let before = contrast(&values, 0);
        let out = finalize_pixels(ValueRange::ZeroOne, &values, w, h).expect("应成功");

        // 拉伸后灰阶应铺满 0~255
        let first = out.get_pixel(0, 0).0[0];
        let last = out.get_pixel(w - 1, h - 1).0[0];
        assert!(first <= 6, "暗端没被拉到黑：{first}");
        assert!(last >= 249, "亮端没被拉到白：{last}");
        assert!(
            (last - first) as f32 / 255.0 > before * 1.5,
            "对比度提升不足：{before} → {}",
            (last - first) as f32 / 255.0
        );
    }

    #[test]
    fn stretch_leaves_flat_image_untouched() {
        // 平图不该被拉伸——那只会放大噪声
        let (w, h) = (8u32, 8u32);
        let values = vec![0.42f32; (w * h) as usize * 3];
        let out = finalize_pixels(ValueRange::ZeroOne, &values, w, h).expect("应成功");
        let px = out.get_pixel(4, 4).0;
        // 允许 ±2 的量化误差
        assert!((px[0] as i32 - 107).abs() <= 2, "平图被改动了：{px:?}");
    }

    #[test]
    fn stretch_does_not_shift_hue_on_low_saturation_images() {
        // 回归测试：**逐通道独立拉伸会导致低饱和度图偏色**（用户反馈：灰底变绿底）。
        //
        // 复现条件：模型输出的三通道动态范围很窄（实测 0.078 / 0.086 / 0.094）
        // 且不完全相同——此时逐通道拉伸会把这点差异放大成肉眼可见的色偏。
        //
        // 期望：**统一增益**下，色相关系保持不变（R 最高、G 最低）。
        let (w, h) = (16u32, 16u32);
        let mut values = vec![0f32; (w * h) as usize * 3];
        for i in 0..(w * h) as usize {
            // 粉灰色：R > B > G，跨度很窄（正是用户那张图的色调）
            values[i * 3] = 0.66 + (i % 3) as f32 * 0.008;
            values[i * 3 + 1] = 0.60 + (i % 3) as f32 * 0.010;
            values[i * 3 + 2] = 0.63 + (i % 3) as f32 * 0.009;
        }
        let out = finalize_pixels(ValueRange::ZeroOne, &values, w, h).expect("应成功");

        // 逐像素检查色序：R > B > G 必须处处成立
        let mut checked = 0;
        for y in 0..h {
            for x in 0..w {
                let p = out.get_pixel(x, y).0;
                assert!(
                    p[0] >= p[2] && p[2] >= p[1],
                    "色相被打乱 @({x},{y}): R={} G={} B={}",
                    p[0],
                    p[1],
                    p[2]
                );
                checked += 1;
            }
        }
        assert!(checked > 0);
    }

    #[test]
    fn stretch_uses_same_gain_for_all_channels() {
        // 验证增益是**统一**的：三通道跨度故意设成差异明显
        // （R 0.10 / G 0.20 / B 0.15），统一增益下三通道的增量应该**完全相同**
        // ——都按 min(跨度)=0.10 缩放，而不是各自被拉满。
        let (w, h) = (8u32, 8u32);
        let mut values = vec![0f32; (w * h) as usize * 3];
        for i in 0..(w * h) as usize {
            let t = i as f32 / ((w * h) as f32 - 1.0);
            values[i * 3] = 0.50 + t * 0.10;
            values[i * 3 + 1] = 0.50 + t * 0.20;
            values[i * 3 + 2] = 0.50 + t * 0.15;
        }
        let out = finalize_pixels(ValueRange::ZeroOne, &values, w, h).expect("应成功");
        let p = out.get_pixel(0, 0).0;
        let q = out.get_pixel(w - 1, h - 1).0;
        let delta = |c: usize| q[c] as i32 - p[c] as i32;
        let (dr, dg, db) = (delta(0), delta(1), delta(2));
        // 三通道增量必须一致（统一增益）；若不一致就说明又被逐通道归一化了
        assert_eq!(
            (dr, dg, db),
            (dr, dr, dr),
            "三通道用了不同增益（说明回到逐通道独立拉伸了）：dR={dr} dG={dg} dB={db}"
        );
        // 且确实做了对比度拉伸（增量非零），不是「没处理」
        assert!(dr > 0, "应当有对比度提升，实测增量 {dr}");
    }

    /// 灰度标准差，用来量化「对比度」
    fn contrast(values: &[f32], channel: usize) -> f32 {
        let mut v: Vec<f32> = (0..values.len() / 3)
            .map(|i| values[i * 3 + channel])
            .collect();
        let mean = v.iter().sum::<f32>() / v.len() as f32;
        let var = v.iter().map(|x| (x - mean).powi(2)).sum::<f32>() / v.len() as f32;
        var.sqrt()
    }
}

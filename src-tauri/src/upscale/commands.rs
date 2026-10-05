//! 对前端暴露的超分命令（IPC 薄封装，推理实现在 `super::inference`）。
//!
//! 命令名与参数名是公开契约：`src/services/upscale.ts` 按名字 invoke，别重命名。

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::AppHandle;

use crate::fs::paths::{data_root, guard_path};

use super::inference;
use super::model;

/// 单个模型的对外描述（前端设置页列表用）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub label: String,
    pub note: String,
    pub scale: u32,
    /// 预计下载体积（字节）；已下载时为 0
    pub size_bytes: u64,
    /// 本机是否已下载
    pub installed: bool,
}

/// 一张图的超分结果
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpscaleResult {
    /// 落盘后的绝对路径（前端直接塞进 `GeneratedImage.path`）
    pub path: String,
    /// 数据目录内的相对路径，形如 `images/{id}.png`
    pub relative_path: String,
    pub width: u32,
    pub height: u32,
    pub scale: u32,
    /// 实际使用的推理后端（`"cpu"` / `"directml"`）
    pub backend: String,
}

/// 本机超分能力概览（前端据此决定「超分」按钮是否可用、以及提示什么）
///
/// **只查文件、不建会话**——建会话要 1~2 秒（阻塞），
/// 而这个命令在 App 启动 / 打开设置页 / 下载完成时都会被调。
/// GPU 是否可用走单独的 [`upscale_probe_gpu`]。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpscaleStatus {
    /// 是否有任何模型已就绪
    pub available: bool,
    /// 已下载的模型 id 列表
    pub installed: Vec<String>,
    /// 默认模型 id
    pub default_model: String,
}

fn model_file(app: &AppHandle, model: &model::UpscaleModel) -> Result<PathBuf, String> {
    let root = data_root(app)?;
    Ok(model::model_path(&root, model))
}

/// 本机是否已下载该模型
fn is_installed(app: &AppHandle, model: &model::UpscaleModel) -> bool {
    model_file(app, model)
        .map(|p| p.exists() && p.metadata().map(|m| m.len() > 0).unwrap_or(false))
        .unwrap_or(false)
}

/** 超分能力概览（轻量：只查文件是否存在，不建会话） */
#[tauri::command]
pub fn upscale_status(app: AppHandle) -> Result<UpscaleStatus, String> {
    let installed: Vec<String> = model::MODELS
        .iter()
        .filter(|m| is_installed(&app, m))
        .map(|m| m.id.to_string())
        .collect();
    Ok(UpscaleStatus {
        available: !installed.is_empty(),
        installed,
        default_model: model::default_model_id().to_string(),
    })
}

/**
 * 探测本机是否支持 GPU 加速（DirectML）。
 *
 * **单独一个命令而不是塞进 `upscale_status`**：探测要真的建一次 ONNX 会话
 * （实测 1~2 秒），那是阻塞操作。放在 `upscale_status` 里会让
 * **每次**读状态都卡 1~2 秒——而 App 启动、设置页打开、下载完成都会读它。
 * 拆开后只有用户在设置页点了「检测」或首次开超分页时才付这个成本。
 */
#[tauri::command]
pub async fn upscale_probe_gpu(app: AppHandle, model_id: Option<String>) -> GpuProbe {
    let meta = match model::find(
        model_id
            .as_deref()
            .unwrap_or_else(|| model::default_model_id()),
    ) {
        Ok(m) => m,
        Err(e) => {
            return GpuProbe {
                supported: false,
                reason: e,
            }
        }
    };
    let file = match model_file(&app, meta) {
        Ok(f) => f,
        Err(e) => {
            return GpuProbe {
                supported: false,
                reason: e,
            }
        }
    };

    // 建会话是阻塞的，放线程池里免得占住命令线程
    match tauri::async_runtime::spawn_blocking(move || super::ep::probe_directml(&file)).await {
        Ok(Ok(())) => GpuProbe {
            supported: true,
            reason: String::new(),
        },
        Ok(Err(reason)) => GpuProbe {
            supported: false,
            reason,
        },
        Err(e) => GpuProbe {
            supported: false,
            reason: format!("检测任务异常终止：{e}"),
        },
    }
}

/** GPU 探测结果 */
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuProbe {
    pub supported: bool,
    /// 不支持时的原因（面向用户，可直接展示）
    pub reason: String,
}

/** 模型列表（含本机已下载状态） */
#[tauri::command]
pub fn upscale_list_models(app: AppHandle) -> Result<Vec<ModelInfo>, String> {
    Ok(model::MODELS
        .iter()
        .map(|m| ModelInfo {
            id: m.id.to_string(),
            label: m.label.to_string(),
            note: m.note.to_string(),
            scale: m.scale,
            size_bytes: if is_installed(&app, m) {
                0
            } else {
                m.size_bytes
            },
            installed: is_installed(&app, m),
        })
        .collect())
}

/**
 * 下载模型。
 *
 * 走 `http` 域的共享客户端（连接池复用），多来源自动兜底。
 * 下载完顺手删掉会话缓存里的旧条目——否则用户「重新下载」后
 * 推理还在用内存里那个旧的、可能已经损坏的会话。
 */
#[tauri::command]
pub async fn upscale_download_model(app: AppHandle, model_id: String) -> Result<String, String> {
    let meta = model::find(&model_id)?;
    let dest = model_file(&app, meta)?;
    model::download_to(meta, &dest).await?;
    model::forget_session(meta.id);
    Ok(meta.label.to_string())
}

/** 删除已下载的模型文件 */
#[tauri::command]
pub fn upscale_remove_model(app: AppHandle, model_id: String) -> Result<(), String> {
    let meta = model::find(&model_id)?;
    let dest = model_file(&app, meta)?;
    model::forget_session(meta.id);
    if dest.exists() {
        std::fs::remove_file(&dest).map_err(|e| format!("删除模型文件失败：{e}"))?;
    }
    Ok(())
}

/**
 * 单张图片超分。
 *
 * `source` 与 `out_relative` 都要过 `guard_path`——它们都来自前端，
 * 不能因为「超分是内部功能」就跳过白名单。
 *
 * 推理是 CPU 密集的同步操作，放 `spawn_blocking` 里跑：
 * 直接在命令线程里跑会占住 Tauri 的 worker，
 * 期间窗口会「未响应」，而超分一张图可能要好几秒。
 */
#[tauri::command]
pub async fn upscale_image(
    app: AppHandle,
    source: String,
    out_path: String,
    model_id: Option<String>,
    scale: Option<u32>,
    use_gpu: Option<bool>,
    max_edge: Option<u32>,
) -> Result<UpscaleResult, String> {
    let src = guard_path(&app, &source)?;
    // `out_path` 必须是**绝对路径**（前端经 `toAbsolutePath()` 转换）：
    // guard_path 只按绝对路径判白名单，传相对路径会一律被拒。
    let out = guard_path(&app, &out_path)?;
    let meta = model::find(
        model_id
            .as_deref()
            .unwrap_or_else(|| model::default_model_id()),
    )?;
    let scale = resolve_scale(scale, meta.scale)?;
    let gpu = use_gpu.unwrap_or(false);
    let model_file = model_file(&app, meta)?;
    // 输出长边上限（可选）
    let edge = max_edge.filter(|v| *v >= 256);

    let result = tauri::async_runtime::spawn_blocking(move || {
        let upscaled = inference::upscale_file(meta, &model_file, &src, scale, gpu, edge)?;
        let bytes = inference::encode_png(&upscaled.image)?;
        Ok::<_, String>((
            upscaled.scale,
            bytes,
            upscaled.backend,
            upscaled.image.dimensions(),
        ))
    })
    .await
    .map_err(|e| format!("超分任务异常终止：{e}"))??;

    let (scale, bytes, backend, (w, h)) = result;
    let backend_label = backend.label().to_string();
    if let Some(parent) = out.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建输出目录失败：{e}"))?;
    }
    std::fs::write(&out, &bytes).map_err(|e| format!("写入超分结果失败：{e}"))?;

    let relative = relative_to_root(&app, &out);
    Ok(UpscaleResult {
        path: out.to_string_lossy().to_string(),
        relative_path: relative,
        width: w,
        height: h,
        scale,
        backend: backend_label,
    })
}

/// 把绝对路径换算成数据目录内的相对路径（`images/xxx.png`）。
///
/// 给前端做「按相对路径删除 / 列目录」时用；换算不出就退回空串，
/// 让调用方自己走绝对路径那条路，而不是拿一个错的相对路径去操作文件。
fn relative_to_root(app: &AppHandle, absolute: &Path) -> String {
    let root = match data_root(app) {
        Ok(r) => r,
        Err(_) => return String::new(),
    };
    absolute
        .strip_prefix(&root)
        .ok()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default()
}

/** 可选的放大倍数上限。8× 已远超实用需求，再高只是浪费内存和时间。 */
const MAX_SCALE: u32 = 8;

/**
 * 校验「目标放大倍数」。
 *
 * **只接受模型原生支持的那一档**，别的一律拒绝。
 *
 * 曾经允许 2×/3×（推理后重采样），看着像是给了用户更多选择，实际是个陷阱：
 * 模型**仍然要跑完整的原生倍数推理**，耗时一点不减，只是最后缩回去。
 * 用户在界面上选 2×，看到「处理中…」迟迟不出结果，以为卡死了。
 * 想要真正的 2×/3×，得注册对应档位的模型（如 `realesr-animevideov3-x2/-x3`），
 * 那是实打实的换模型，不是插值能等价替代的。
 *
 * 前端 `scaleOptions` 也只列原生档位，两边保持一致。
 */
fn resolve_scale(requested: Option<u32>, model_scale: u32) -> Result<u32, String> {
    match requested {
        None => Ok(model_scale),
        Some(0) => Err("放大倍数必须大于 0".to_string()),
        Some(v) if v > MAX_SCALE => Err(format!("放大倍数过大（{v}×），上限为 {MAX_SCALE}×")),
        Some(v) if v != model_scale => Err(format!(
            "当前模型只支持 {model_scale}× 放大（{v}× 需要对应档位的模型）"
        )),
        Some(v) => Ok(v),
    }
}

/**
 * 批量超分。
 *
 * 逐张串行而不是并发：ONNX Runtime 的单个会话是加锁串行化的，
 * 再开多个任务只会让它们排队，还会同时占住多份全图累加缓冲。
 * 失败不中断整批——单张图有问题（比如格式不支持）不该拖垮其余。
 */
#[tauri::command]
pub async fn upscale_batch(
    app: AppHandle,
    sources: Vec<String>,
    out_paths: Vec<String>,
    model_id: Option<String>,
    scale: Option<u32>,
    use_gpu: Option<bool>,
    max_edge: Option<u32>,
) -> Result<Vec<UpscaleResult>, String> {
    if sources.len() != out_paths.len() {
        return Err("批量超分的源文件与输出路径数量不一致".to_string());
    }
    let meta = model::find(
        model_id
            .as_deref()
            .unwrap_or_else(|| model::default_model_id()),
    )?;
    let scale = resolve_scale(scale, meta.scale)?;
    let gpu = use_gpu.unwrap_or(false);
    let edge = max_edge.filter(|v| *v >= 256);
    let model_file = model_file(&app, meta)?;

    let mut done = Vec::new();
    // 逐张的失败原因攒起来，最后一并回给前端。
    // **绝不能只返回空数组**：那会让界面显示「全部失败」却说不出为什么，
    // 用户只能猜是不是模型坏了。
    let mut failures: Vec<String> = Vec::new();

    for (source, out_path) in sources.into_iter().zip(out_paths.into_iter()) {
        let src = match guard_path(&app, &source) {
            Ok(p) => p,
            Err(err) => {
                failures.push(format!("{source}：{err}"));
                continue;
            }
        };
        let out = match guard_path(&app, &out_path) {
            Ok(p) => p,
            Err(err) => {
                failures.push(format!("{out_path}：{err}"));
                continue;
            }
        };

        let meta_ref = meta;
        let file_ref = model_file.clone();
        // 用外层的 `gpu`（已 unwrap_or(false) 成 bool），别在这里再解一次
        let label = out_path.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            let upscaled = inference::upscale_file(meta_ref, &file_ref, &src, scale, gpu, edge)?;
            let bytes = inference::encode_png(&upscaled.image)?;
            let backend = upscaled.backend;
            if let Some(parent) = out.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("创建输出目录失败：{e}"))?;
            }
            std::fs::write(&out, &bytes).map_err(|e| format!("写入超分结果失败：{e}"))?;
            Ok::<_, String>((upscaled.scale, out, backend, upscaled.image.dimensions()))
        })
        .await;

        match outcome {
            Ok(Ok((scale, written, backend, (ow, oh)))) => {
                let relative = relative_to_root(&app, &written);
                let backend_label = backend.label().to_string();
                done.push(UpscaleResult {
                    path: written.to_string_lossy().to_string(),
                    relative_path: relative,
                    width: ow,
                    height: oh,
                    scale,
                    backend: backend_label,
                });
            }
            Ok(Err(err)) => failures.push(format!("{label}：{err}")),
            Err(err) => failures.push(format!("{label}：任务异常终止 {err}")),
        }
    }

    // 一张都没成时把原因带回去，让界面能说清是模型没下载、路径被拒还是格式不对
    if done.is_empty() && !failures.is_empty() {
        return Err(format!("全部图片都超分失败：\n{}", failures.join("\n")));
    }
    // 部分失败：走 eprintln 留痕，不阻断已成功的那些
    if !failures.is_empty() {
        eprintln!(
            "[upscale] {} 张失败：\n{}",
            failures.len(),
            failures.join("\n")
        );
    }
    Ok(done)
}

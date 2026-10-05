//! 对前端暴露的本地文件命令（IPC 薄封装，路径校验在 `super::paths`）。
//!
//! 命令名与参数名是公开契约：`src/platform/storage.ts` 直接按名字 invoke，
//! 不要重命名。

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use tauri::{AppHandle, Manager};

use super::paths::{data_root, ensure_parent, guard_path};

/// 把应用数据目录告诉前端，前端据此拼出各类资源的绝对路径。
#[tauri::command]
pub fn app_data_root(app: AppHandle) -> Result<String, String> {
    Ok(data_root(&app)?.to_string_lossy().to_string())
}

#[tauri::command]
pub fn ensure_dir(app: AppHandle, path: String) -> Result<(), String> {
    guard_path(&app, &path)?;
    std::fs::create_dir_all(&path).map_err(|e| format!("创建目录失败: {e}"))
}

/// 写入二进制内容（base64 入参），返回最终绝对路径。
#[tauri::command]
pub fn write_binary(app: AppHandle, path: String, data_base64: String) -> Result<String, String> {
    let target = guard_path(&app, &path)?;
    ensure_parent(&target)?;
    let bytes = B64
        .decode(data_base64.as_bytes())
        .map_err(|e| format!("解码内容失败: {e}"))?;
    std::fs::write(&target, bytes).map_err(|e| format!("写入文件失败: {e}"))?;
    Ok(target.to_string_lossy().to_string())
}

/// 读取文件并返回 base64（图片等二进制资源走这条）。
#[tauri::command]
pub fn read_binary(app: AppHandle, path: String) -> Result<String, String> {
    let target = guard_path(&app, &path)?;
    let bytes = std::fs::read(&target).map_err(|e| format!("读取文件失败: {e}"))?;
    Ok(B64.encode(bytes))
}

#[tauri::command]
pub fn write_text(app: AppHandle, path: String, contents: String) -> Result<(), String> {
    let target = guard_path(&app, &path)?;
    ensure_parent(&target)?;
    std::fs::write(&target, contents).map_err(|e| format!("写入文件失败: {e}"))
}

/// 读取文本。文件不存在不算错误，返回 `None` 让前端走默认值，
/// 这样首次启动时不用先判断文件是否存在。
#[tauri::command]
pub fn read_text(app: AppHandle, path: String) -> Result<Option<String>, String> {
    let target = guard_path(&app, &path)?;
    if !target.exists() {
        return Ok(None);
    }
    match std::fs::read_to_string(&target) {
        Ok(text) => Ok(Some(text)),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub fn path_exists(app: AppHandle, path: String) -> Result<bool, String> {
    Ok(guard_path(&app, &path)?.exists())
}

/// 删除文件或目录（不存在时静默成功，便于幂等调用）。
///
/// 删图片时会顺带清掉它的缩略图（`thumbs/{stem}_*.jpg`）。
///
/// **必须挂在这里而不是让前端记得调 `thumb_forget`**：`remove_path` 是
/// 所有删除路径的唯一出口（删记录、清空历史、`sweep_orphans` 回收孤儿、
/// 数据目录整体清空都走它）。清理缩略图是「删原图」的固有后半步，
/// 挂在前端就等于要求每个调用方都记得补一刀——漏一处就留下
/// 「原图早没了、缩略图还占着磁盘」的垃圾，而且没人会发现。
#[tauri::command]
pub fn remove_path(app: AppHandle, path: String) -> Result<(), String> {
    let target = guard_path(&app, &path)?;
    if !target.exists() {
        return Ok(());
    }
    if target.is_dir() {
        std::fs::remove_dir_all(&target).map_err(|e| format!("删除目录失败: {e}"))
    } else {
        // 缩略图清理失败不影响删除本身：它只是缓存，残留最坏是占点磁盘
        let _ = crate::thumb::commands::purge_for(&crate::thumb::cache::dir(&app)?, &target);
        std::fs::remove_file(&target).map_err(|e| format!("删除文件失败: {e}"))
    }
}

/// 列出目录下的直接子文件名（不递归）。
/// 用于「孤儿图片」扫描：找出磁盘上还在、但历史记录里已无引用的文件。
#[tauri::command]
pub fn list_dir(app: AppHandle, path: String) -> Result<Vec<String>, String> {
    let target = guard_path(&app, &path)?;
    if !target.is_dir() {
        return Ok(Vec::new());
    }
    let entries = std::fs::read_dir(&target).map_err(|e| format!("读取目录失败: {e}"))?;
    let mut names = Vec::new();
    for entry in entries.flatten() {
        names.push(entry.file_name().to_string_lossy().to_string());
    }
    Ok(names)
}

/// 导出文件到系统图片目录（`Mashiro Studio` 子目录），返回新路径。
#[tauri::command]
pub fn export_copy(app: AppHandle, source: String, file_name: String) -> Result<String, String> {
    let src = guard_path(&app, &source)?;
    if !src.exists() {
        return Err("源文件不存在".to_string());
    }
    let base = app
        .path()
        .picture_dir()
        .or_else(|_| app.path().download_dir())
        .map_err(|e| format!("无法定位导出目录: {e}"))?;
    let dir = base.join("Mashiro Studio");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建导出目录失败: {e}"))?;
    let dest = dir.join(file_name);
    std::fs::copy(&src, &dest).map_err(|e| format!("导出失败: {e}"))?;
    Ok(dest.to_string_lossy().to_string())
}

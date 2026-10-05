//! 缩略图缓存的落盘位置与有效性判定。
//!
//! 缩略图存数据目录下的 `thumbs/`，文件名从原图派生：
//! `原图名_长边.jpg`（`img_abc123_512.jpg`）。
//!
//! **不用 mtime 而不用内容哈希**：原图是不可变产物（生成一次就再也不改），
//! 内容哈希要对 126MB 的文件读一遍来算——那比重新缩放还贵。
//! 派生文件名 + 「文件存在且非空」就够了。

use std::path::{Path, PathBuf};

use tauri::AppHandle;

use crate::fs::paths::{data_root, ensure_parent};

/// 缩略图目录名（数据目录下）
pub(crate) const DIR: &str = "thumbs";

/// 缩略图目录的绝对路径（不存在则创建）
pub(crate) fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = data_root(app)?.join(DIR);
    ensure_parent(&path)?;
    std::fs::create_dir_all(&path).map_err(|e| format!("创建缩略图目录失败: {e}"))?;
    Ok(path)
}

/// 原图 → 缩略图路径：`img_abc.png` + 512 → `img_abc_512.jpg`
///
/// 返回 `None` 表示原图名里拿不出可用的 stem
/// （正常图片文件不会这样，但 `path` 来自前端，不能假设）。
pub(crate) fn thumb_path(dir: &Path, source: &Path, max_edge: u32) -> Option<PathBuf> {
    let stem = source.file_stem()?.to_str()?;
    // stem 里可能带路径分隔符以外的怪字符，但不会是分隔符（file_stem 保证）
    Some(dir.join(format!("{stem}_{max_edge}.jpg")))
}

/**
 * 缓存是否可用。
 *
 * 判「存在且非空」而不是只判「存在」：写缩略图走 `.part` + rename，
 * 进程如果在 rename 前被杀，理论上可能留下 0 字节文件
 * （项目里 `build.rs` 踩过同类的坑）。
 */
pub(crate) fn is_cached(path: &Path) -> bool {
    path.metadata()
        .map(|m| m.is_file() && m.len() > 0)
        .unwrap_or(false)
}

//! 「在文件管理器中定位文件」——各平台各自的实现。

use std::path::PathBuf;

/// 在系统文件管理器中定位文件（Windows 资源管理器 / macOS 访达 / Linux 文件管理器）。
///
/// 注意：这里刻意不经过 `guard_path`——它只负责「把已有文件显示出来」，
/// 不读内容也不改内容，没有越权风险，而用户导出的文件本来就在白名单之外。
#[tauri::command]
pub fn reveal_in_folder(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err(format!("文件不存在：{path}"));
    }
    #[cfg(target_os = "windows")]
    {
        // 关键：explorer 的 /select, 只接受反斜杠路径。
        // 传正斜杠时它不会选中目标，而是打开默认目录（实测会跳到桌面），
        // 表现为「点了定位却什么都没选中」。这里统一换成原生分隔符。
        let native = target.to_string_lossy().replace('/', "\\");
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", native))
            .spawn()
            .map_err(|e| format!("打开资源管理器失败: {e}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&target)
            .spawn()
            .map_err(|e| format!("打开访达失败: {e}"))?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let parent = target.parent().unwrap_or(&target);
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| format!("打开文件管理器失败: {e}"))?;
    }
    Ok(())
}

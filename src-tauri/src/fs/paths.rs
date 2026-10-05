//! 数据目录定位与路径白名单。
//!
//! 这是文件域的安全边界：**任何**读写命令都必须先过 [`guard_path`]，
//! 防止前端（或注入的脚本）拿着任意路径去读写用户磁盘上的其他文件。

use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Manager};

/// 应用数据目录（不存在则创建）。历史记录、生成结果、配置都落在这里。
pub(crate) fn data_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建应用数据目录失败: {e}"))?;
    Ok(dir)
}

/// 词法归一化：消解 `.` 与 `..`，不触碰文件系统。
///
/// **白名单判定前必须先走这一步。** `Path::starts_with` 是逐组件比较，
/// 不会解析 `..`：`<root>\..\..\Windows\System32` 的 `starts_with(root)`
/// 依然返回 `true`，而后续 `fs::write` / `fs::read` 会照常把 `..` 解析掉、
/// 真的写到目录外去。少了这一步，这道「安全边界」等于没设。
///
/// 返回 `None` 表示路径非法：`..` 一路弹到根还想再往上，即意图越界。
fn normalize(path: &Path) -> Option<PathBuf> {
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            // 前缀与根目录原样保留（Windows 的 `C:` + `\`、UNC 前缀等）
            Component::Prefix(_) | Component::RootDir => out.push(comp.as_os_str()),
            Component::CurDir => {}
            Component::Normal(seg) => out.push(seg),
            // 要往上弹一层；已经弹到顶还遇到 `..`，说明要越出根
            Component::ParentDir => {
                if !out.pop() {
                    return None;
                }
            }
        }
    }
    Some(out)
}

/// 白名单根目录：应用数据目录 + 用户可见的导出目录（导出功能会往这些地方写文件）。
/// 全部已做词法归一化，可直接与归一化后的目标做 `starts_with` 比较。
fn allowed_roots(app: &AppHandle, root: &Path) -> Vec<PathBuf> {
    let mut roots = vec![root.to_path_buf()];
    for dir in [
        app.path().picture_dir().ok(),
        app.path().download_dir().ok(),
        app.path().desktop_dir().ok(),
    ]
    .into_iter()
    .flatten()
    {
        if let Some(dir) = normalize(&dir) {
            roots.push(dir);
        }
    }
    roots
}

/// 解析「已存在的最深祖先」的真实路径，用来识别目录内的符号链接 / 目录联接。
///
/// 目标文件本身可能还不存在（写入新文件的场景），所以从它自己开始逐级上溯，
/// 找到第一个能 canonicalize 的祖先，再把剩余段拼回去。
///
/// 只用于**判定**，其返回值不会外泄给调用方：Windows 上 canonicalize 会带
/// `\\?\` 前缀，直接存进历史记录会让 `explorer /select,` 之类的路径难用。
fn resolve_real_path(target: &Path) -> Option<PathBuf> {
    let mut cursor = Some(target);
    while let Some(path) = cursor {
        if let Ok(real) = path.canonicalize() {
            let rest = target.strip_prefix(path).ok()?;
            return Some(real.join(rest));
        }
        cursor = path.parent();
    }
    None
}

/// 路径校验：只放行应用数据目录，以及用户可见的导出目录。
///
/// 两道关：
/// 1. **词法**——归一化掉 `..` 后比较，挡住 `root\..\..\Windows\...` 这类明面越界；
/// 2. **真实**——再按 canonical 路径比一次，挡住「数据目录里放了个指向外部的
///    符号链接 / 目录联接」这种词法看不出来的越界。
///
/// 返回的是**词法归一化后**的路径（干净、无 `\\?\` 前缀），不是 canonical 版。
pub(crate) fn guard_path(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    const DENIED: &str = "拒绝访问应用数据目录之外的文件";
    let root = data_root(app)?;

    // 第一道：词法。顺序不能反，必须先归一化再判白名单。
    let target =
        normalize(Path::new(path)).ok_or_else(|| format!("{DENIED}：路径试图越出应用数据目录"))?;
    if !allowed_roots(app, &root)
        .iter()
        .any(|allowed| target.starts_with(allowed))
    {
        return Err(DENIED.to_string());
    }

    // 第二道：真实路径。两侧都要 canonicalize 后再比——
    // Windows 上 canonicalize 结果带 `\\?\` 前缀，跟未 canonicalize 的根比必然不相等。
    let real_roots: Vec<PathBuf> = allowed_roots(app, &root)
        .iter()
        .filter_map(|allowed| allowed.canonicalize().ok())
        .collect();
    if !real_roots.is_empty() {
        if let Some(real_target) = resolve_real_path(&target) {
            if !real_roots
                .iter()
                .any(|allowed| real_target.starts_with(allowed))
            {
                return Err(DENIED.to_string());
            }
        }
    }

    Ok(target)
}

/// 写文件前保证父目录存在。
pub(crate) fn ensure_parent(target: &Path) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 模拟一个数据根，返回「是否落在根内」。
    fn within_root(candidate: &Path, root: &Path) -> bool {
        candidate.starts_with(root)
    }

    /// `normalize` + 白名单判定的组合行为（不依赖 AppHandle）。
    fn check(raw: &str, root: &Path) -> bool {
        match normalize(Path::new(raw)) {
            Some(target) => within_root(&target, root),
            None => false,
        }
    }

    #[test]
    fn allows_paths_inside_root() {
        let root = PathBuf::from(r"C:\Users\test\AppData\Roaming\com.mashiro.imagegen");
        assert!(check(
            r"C:\Users\test\AppData\Roaming\com.mashiro.imagegen\store\settings.json",
            &root
        ));
        assert!(check(
            r"C:\Users\test\AppData\Roaming\com.mashiro.imagegen\images\a.png",
            &root
        ));
    }

    #[test]
    fn allows_dot_dot_that_stays_inside() {
        // 归一化后仍应落在根内，不能一刀切拒绝所有 `..`
        let root = PathBuf::from(r"C:\Users\test\AppData\Roaming\com.mashiro.imagegen");
        assert!(check(
            r"C:\Users\test\AppData\Roaming\com.mashiro.imagegen\store\..\store\x.json",
            &root
        ));
    }

    #[test]
    fn blocks_traversal_out_of_root() {
        // 这是 guard_path 存在的理由：starts_with 单独用会把这些全部放行
        let root = PathBuf::from(r"C:\Users\test\AppData\Roaming\com.mashiro.imagegen");
        for evil in [
            r"C:\Users\test\AppData\Roaming\com.mashiro.imagegen\..\..\..\Windows\System32\drivers\etc\hosts",
            r"C:\Users\test\AppData\Roaming\com.mashiro.imagegen\..\..\Startup\evil.exe",
            r"C:\Users\test\AppData\Roaming\com.mashiro.imagegen\store\..\..\..\..\Documents\secret.txt",
        ] {
            assert!(!check(evil, &root), "越界路径竟被放行: {evil}");
        }
    }

    #[test]
    fn blocks_unrelated_absolute_paths() {
        let root = PathBuf::from(r"C:\Users\test\AppData\Roaming\com.mashiro.imagegen");
        assert!(!check(r"C:\Windows\System32\config\SAM", &root));
    }

    #[test]
    fn blocks_parent_dir_escaping_filesystem_root() {
        // `..` 弹到盘符根部还想再往上 → normalize 直接判非法
        assert!(normalize(Path::new(r"..\..\..\Windows\x")).is_none());
    }

    #[test]
    fn normalize_is_idempotent() {
        let once = normalize(Path::new(r"C:\a\b\..\b\c")).expect("应合法");
        let twice = normalize(&once).expect("应合法");
        assert_eq!(once, twice);
    }
}

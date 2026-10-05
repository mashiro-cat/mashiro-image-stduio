//! 构建脚本。
//!
//! 除了 Tauri 自身的 codegen，这里还负责一件 ort 相关的收尾：
//! **把 ONNX Runtime 的运行时依赖补到测试可执行文件旁边**。
//!
//! # 为什么需要它
//!
//! `ort` 的 `copy-dylibs` 只把 `DirectML.dll` 拷到**构建脚本的 `OUT_DIR`**，
//! 而 `cargo test` 产出的 exe 在 `target/debug/deps/`——两者不是一个地方。
//! 结果是主程序能跑、`cargo test --lib` 却以 `0xc0000020`（DLL 找不到）
//! **直接起不来**，连与超分无关的 `fs/paths.rs` 测试也一起挂掉。
//!
//! 这个脚本在 `build.rs` 阶段（晚于 ort-sys 的 build 脚本）把 dll 补到
//! `target/<profile>/`、`target/<profile>/deps/` 与 `target/<profile>/examples/`，
//! 顺带**修掉 0 字节的坏文件**（ort 的复制在某些环境下会留下空文件，
//! 比缺文件更难查）。

use std::path::{Path, PathBuf};

fn main() {
    tauri_build::build();
    ensure_ort_dylibs();
}

/// ONNX Runtime 静态库附带的运行时 dll（按需扩充）。
const RUNTIME_DLLS: &[&str] = &["DirectML.dll"];

fn ensure_ort_dylibs() {
    // 目标目录：`target/<profile>/` 及其 deps / examples 子目录
    let Ok(out_dir) = std::env::var("OUT_DIR") else {
        return;
    };
    // OUT_DIR 形如 `<target>/<profile>/build/<pkg>-<hash>/out`
    //   ancestors(): 0=out 1=<pkg>-<hash> 2=build 3=<profile> 4=<target>
    let Some(profile_dir) = PathBuf::from(&out_dir)
        .ancestors()
        .nth(3)
        .map(Path::to_path_buf)
    else {
        return;
    };

    // 候选来源：ort 的缓存目录（权威），以及构建目录附近 ort-sys 拷的那份
    let mut sources: Vec<PathBuf> = Vec::new();
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let cache = Path::new(&local).join("ort.pyke.io").join("dfbin");
        collect_dlls(&cache, &mut sources);
    }
    if let Some(build_root) = profile_dir.parent() {
        collect_dlls(&build_root.join("build"), &mut sources);
    }

    if sources.is_empty() {
        println!("cargo:warning=[upscale] 未找到 ONNX Runtime 运行时 dll；若超分报 0xc0000020 请手动处理");
        return;
    }

    let mut targets = vec![profile_dir.clone()];
    for sub in ["deps", "examples"] {
        let dir = profile_dir.join(sub);
        if dir.is_dir() {
            targets.push(dir);
        }
    }

    for target in targets {
        for name in RUNTIME_DLLS {
            let Some(src) = sources.iter().find(|s| {
                s.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.eq_ignore_ascii_case(name))
            }) else {
                continue;
            };
            // 源本身是空文件就不要拷——宁可让下游报「找不到」，也不要放个 0 字节的
            if std::fs::metadata(src).map(|m| m.len()).unwrap_or(0) == 0 {
                continue;
            }
            let dest = target.join(name);
            let needs_copy = match std::fs::metadata(&dest) {
                Ok(m) => m.len() != std::fs::metadata(src).map(|m| m.len()).unwrap_or(0),
                Err(_) => true,
            };
            if needs_copy && std::fs::copy(src, &dest).is_ok() {
                println!("cargo:warning=[upscale] 已补齐 {}", dest.display());
            }
        }
    }
}

/// 递归收集目录下的指定 dll（深度有限，避免无谓遍历）
fn collect_dlls(dir: &Path, out: &mut Vec<PathBuf>) {
    fn walk(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
        if depth > 3 {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, depth + 1, out);
            } else if path
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| RUNTIME_DLLS.iter().any(|d| n.eq_ignore_ascii_case(d)))
            {
                out.push(path);
            }
        }
    }
    walk(dir, 0, out);
}

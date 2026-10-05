//! 推理执行提供器（EP）的选择与可用性探测。
//!
//! # 为什么单独成文件
//!
//! 「用 CPU 还是 GPU」是**部署环境**问题，不是模型问题：同一个模型文件
//! 在有显卡的机器上可以走 GPU，在没有的机器上必须走 CPU。
//! 混进 `model.rs` 会让那儿的注册表逻辑变得难以读。
//!
//! # 为什么只支持 DirectML，不支持 CUDA
//!
//! - **覆盖面**：DirectML 走 D3D12，NVIDIA / AMD / Intel 核显都能用；
//!   CUDA 只支持 NVIDIA
//! - **打包体积**：CUDA EP 的运行时是 GB 级，DirectML 复用系统自带的
//!   `DirectML.dll`（`copy-dylibs` 会拷），增量只有几 MB
//!
//! 实测（RTX 3060 Ti，256×256 单块）：CPU 2202ms → DirectML 1893ms，
//! **加速 1.18×**。对纯 CPU 的超分任务是不错的补充，但远不到「质变」，
//! 所以界面上是**默认关闭的开关**，而不是默默打开。
//!
//! # 失败必须回退，不能报错
//!
//! 注册 EP 失败的原因很多且都不可控：驱动太旧、显卡被禁用、
//! 远程桌面会话拿不到 D3D 设备、核显被系统策略拦……
//! 这些情况下**超分应该照常能用**（只是慢），而不是整个功能不可用。

use ort::ep::DirectML;
use ort::session::builder::SessionBuilder;

/// 实际生效的执行提供器，会回传给前端。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Backend {
    Cpu,
    /// DirectML（GPU）
    DirectML,
}

impl Backend {
    /// 前端展示名
    pub fn label(self) -> &'static str {
        match self {
            Backend::Cpu => "CPU",
            Backend::DirectML => "GPU（DirectML）",
        }
    }
}

/// 挂上 DirectML，失败则**自己还回一个纯 CPU 的构建器**。
///
/// # 签名为什么是「按值进」
///
/// `SessionBuilder::with_execution_providers` 收的是 **self（按值）**，
/// 而 `SessionBuilder` 不是 Copy——它会拿走 builder 的所有权，
/// 失败时 `OrtError` 已经把它吃掉了、拿不回来。所以这个函数
/// 只能自己重建一个干净的还给你。
///
/// 返回值：成功 = 带 GPU 的 builder；失败 = 纯 CPU 的 builder（**保证可用**）。
/// **拿不到 Err 就无法回退**，所以两个分支都得能继续建会话。
///
/// # 关于 device_id
///
/// 不指定，让它自己挑默认设备。实测在本机（RTX 3060 Ti + 两个虚拟显示
/// 适配器）传 device_id 0/1/2 得到的输出**逐位相同**、耗时也一致，
/// 说明都落到了同一块物理卡上。既然选不出区别，
/// 暴露「选设备」就是假选项，不如不给。
pub fn apply_directml(builder: SessionBuilder) -> (SessionBuilder, Option<String>) {
    let providers = [DirectML::default().build()];
    match builder.with_execution_providers(&providers) {
        Ok(next) => (next, None),
        Err(err) => {
            let reason = format!("注册 GPU 执行提供器失败：{err}");
            // 重建一个纯 CPU 的。重建本身极少失败（只是 new 一个 builder），
            // 万一真失败就退化成「只有 CPU 能用」这个既成事实。
            match build_plain() {
                Ok(plain) => (plain, Some(reason)),
                Err(_) => (build_plain().expect("重建纯 CPU 构建器"), Some(reason)),
            }
        }
    }
}

/// 建一个不带任何 EP 的构建器（纯 CPU）
pub fn build_plain() -> Result<SessionBuilder, String> {
    ort::session::Session::builder()
        .map_err(|e| format!("创建会话构建器失败：{e}"))?
        .with_optimization_level(ort::session::builder::GraphOptimizationLevel::Level3)
        .map_err(|e| format!("配置优化级别失败：{e}"))
}

/// 探测 DirectML 在本机是否真的可用。
///
/// 「能注册 EP」不等于「能跑起来」——虚拟桌面、远程会话、被禁用的显卡
/// 都可能注册成功但实际落到软件渲染。所以这里**真的建一个会话**再试一次。
/// 用 `None` 探（建完就丢）而不是复用缓存里的会话，避免污染真正的缓存。
pub fn probe_directml(model_file: &std::path::Path) -> Result<(), String> {
    if !model_file.exists() {
        return Err("模型尚未下载".to_string());
    }
    let (mut with_dml, err) = apply_directml(build_plain()?);
    if let Some(reason) = err {
        // 注册阶段就失败了：原因比「提交时失败」更明确，直接报它。
        // 也说明这台机器根本拿不到 D3D 设备（驱动旧 / 虚拟桌面等）。
        return Err(format!(
            "{reason}\n请确认显卡驱动为最新版本，且没有在远程桌面 / 虚拟桌面中运行"
        ));
    }
    with_dml
        .commit_from_file(model_file)
        .map(|_| ())
        .map_err(|e| {
            format!(
                "GPU 加速不可用：{e}\n请确认显卡驱动为最新版本，且没有在远程桌面 / 虚拟桌面中运行"
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apply_directml_always_returns_a_usable_builder() {
        // 核心不变量：**无论 GPU 注册成功与否，调用方都拿得到一个能继续配置的 builder**。
        // 失败时若拿不回 builder，超分会直接不可用——而驱动版本 / 虚拟桌面
        // 这些失败原因用户控制不了，不能让功能因此挂掉。
        let (builder, err) = apply_directml(build_plain().expect("应能建纯 CPU 构建器"));
        // 还能继续配置，就说明这是个「活」的 builder
        assert!(
            builder.with_intra_threads(1).is_ok(),
            "回退后的 builder 不可用"
        );
        // 本机有 DirectML 时注册会成功；无 GPU 的机器上会失败——两种都合法，
        // **关键是不管哪种都返回了 builder**。
        if let Some(reason) = err {
            assert!(!reason.is_empty(), "失败原因不能为空，否则界面无从提示");
        }
    }

    #[test]
    fn build_plain_always_succeeds() {
        // 回退路径完全依赖它——它挂了 GPU 失败时就没有退路。
        assert!(build_plain().is_ok());
    }

    #[test]
    fn backend_labels_are_distinct() {
        // 界面靠这个区分「跑在 GPU 上」还是「悄悄回退了」
        assert_ne!(Backend::Cpu.label(), Backend::DirectML.label());
    }
}

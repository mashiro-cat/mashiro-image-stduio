//! 本地超分域。
//!
//! 与 `http`（出网）、`fs`（落盘）不同，本域的推理**完全在本机 CPU 上完成**，
//! 不经过任何远端接口——这是本项目里第一条「不依赖用户配置就能用」的图片处理能力。
//!
//! - [`model`]：可下载的模型注册表 + `Session` 缓存
//! - [`inference`]：分块推理 + 羽化融合（消接缝）
//! - [`ep`]：执行提供器（CPU / DirectML GPU）与可用性探测
//! - [`commands`]：`upscale_status` / `upscale_list_models` / `upscale_image` / `upscale_batch`
//!
//! # GPU 加速
//!
//! 有显卡的机器可以启用 **DirectML**（D3D12，覆盖 NVIDIA/AMD/Intel 核显）。
//! 实测 RTX 3060 Ti 上约 **1.18×** 加速——是锦上添花而非质变，
//! 所以界面上是**默认关闭的开关**。注册失败会**自动回退 CPU**，
//! 不会让超分变得不可用。详见 [`ep`]。
//!
//! # 模型不随安装包分发
//!
//! 几 MB 到几十 MB 的权重放进安装包会明显拖大体积，且用户未必用得上。
//! 因此模型是**按需下载**的：注册表里只写元信息与下载地址，
//! 首次使用时经 [`commands::download_model`] 落进数据目录 `models/`，
//! 之后完全离线。
//!
//! # ONNX Runtime 为什么是静态链接（`ort` 的 feature 选择）
//!
//! 最早这里用的是 `load-dynamic`，在 Tauri 里**必然失败**，报错：
//! `Failed to load ONNX Runtime dylib: BadVersion { version_str: "1.17.1" }`。
//!
//! 原因：进程跑在 WebView2 里，而 WebView2 自带一份 `onnxruntime.dll`
//! （实测在 `Microsoft\EdgeWebView\Application\135.*\`，版本 1.17.1）。
//! Windows 对同名模块只加载一次，`dlopen("onnxruntime.dll")` 会
//! **复用已加载的那份**，拿不到我们指定的版本。系统 PATH 里的其他副本
//! （PowerToys / WSL / EdgeCore）实测都是 1.23，同样低于
//! ort 2.0.0-rc.13 要求的 1.27。
//!
//! 现在用 `download-binaries`：它在**构建期**把 ONNX Runtime 下一份到
//! `%LOCALAPPDATA%\ort.pyke.io\`，编译时以 **static** 方式链进二进制。
//! 好处是不但版本必然匹配，还**完全不需要运行时 dll**——
//! 顺带让「发布前要自己带 onnxruntime.dll」这个坑也消失了。
//! 代价是构建需要网络（首次约 340MB 静态库，之后走缓存）。
//!
//! **别改回 `load-dynamic`**，理由见上。
//!
//! 前端入口统一是 `src/services/upscale.ts`，别在视图里直接 invoke。

pub(crate) mod commands;
pub(crate) mod ep;
pub(crate) mod inference;
pub(crate) mod model;

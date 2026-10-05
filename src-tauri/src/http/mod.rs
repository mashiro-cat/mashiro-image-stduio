//! 出网代理域。
//!
//! 前端不允许（也不应该）直接 `fetch` 外部 API：那既有 WebView 的 CORS 问题，
//! 又会把密钥暴露在页面网络面板里。所有外部请求统一从这条通道出去。
//!
//! - [`types`]：IPC 契约（请求 / 响应 DTO）
//! - [`client`]：共享 reqwest 客户端、逐请求超时、响应归一化、错误翻译
//! - [`commands`]：`http_request` / `http_multipart`

pub(crate) mod client;
pub(crate) mod commands;
pub(crate) mod types;

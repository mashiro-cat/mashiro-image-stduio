//! 前端 ↔ Rust 的 HTTP 请求 / 响应契约。
//!
//! 所有入参结构体都开了 `#[serde(rename_all = "camelCase")]`，字段名与
//! `src/platform/http.ts` 的 `invoke` 调用一一对应，改字段名必须同步前端。

use serde::{Deserialize, Serialize};

/// 单条 HTTP 头。请求侧和响应侧复用同一个结构，所以双向可序列化。
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct HttpHeader {
    pub name: String,
    pub value: String,
}

/// `http_request` 入参：文本 / JSON 请求体与二进制（base64）请求体二选一。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequestArgs {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: Vec<HttpHeader>,
    /// 文本 / JSON 请求体
    #[serde(default)]
    pub body: Option<String>,
    /// 二进制请求体（base64）
    #[serde(default)]
    pub body_base64: Option<String>,
    /// 覆盖默认超时（毫秒）
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

/// multipart 的单个字段：带 `data_base64` 时作为文件部件，否则退化成普通文本字段。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultipartField {
    pub name: String,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub file_name: Option<String>,
    #[serde(default)]
    pub mime: Option<String>,
    /// 文件内容（base64）
    #[serde(default)]
    pub data_base64: Option<String>,
}

/// `http_multipart` 入参（图生图、工作流素材上传）。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultipartRequestArgs {
    pub url: String,
    #[serde(default)]
    pub headers: Vec<HttpHeader>,
    #[serde(default)]
    pub fields: Vec<MultipartField>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

/// 归一化后的响应：前端只看 `ok` / `status` / `body` 三件事。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponsePayload {
    pub status: u16,
    pub ok: bool,
    pub headers: Vec<HttpHeader>,
    /// 文本响应原文，或二进制响应的 base64
    pub body: String,
    /// `body` 是否为 base64 编码（即响应是二进制）
    pub is_base64: bool,
}

//! 对前端暴露的 HTTP 命令（IPC 薄封装，逻辑在 `super::client`）。
//!
//! 命令名是公开契约：`src/platform/http.ts` 直接按名字 invoke，不要重命名。

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

use super::client::{describe_reqwest_error, request_timeout, shared_client, to_payload};
use super::types::{HttpRequestArgs, HttpResponsePayload, MultipartRequestArgs};

/// 通用 JSON / 文本 / 二进制请求。
#[tauri::command]
pub async fn http_request(args: HttpRequestArgs) -> Result<HttpResponsePayload, String> {
    let client = shared_client()?;
    let method = reqwest::Method::from_bytes(args.method.to_uppercase().as_bytes())
        .map_err(|_| format!("不支持的请求方法: {}", args.method))?;

    let mut req = client
        .request(method, &args.url)
        .timeout(request_timeout(args.timeout_ms));
    for h in &args.headers {
        if h.value.is_empty() {
            continue;
        }
        req = req.header(&h.name, &h.value);
    }
    if let Some(raw) = args.body_base64 {
        let decoded = B64
            .decode(raw.as_bytes())
            .map_err(|e| format!("二进制请求体解码失败: {e}"))?;
        req = req.body(decoded);
    } else if let Some(text) = args.body {
        req = req.body(text);
    }

    let res = req.send().await.map_err(|e| describe_reqwest_error(&e))?;
    to_payload(res).await
}

/// multipart/form-data 请求（图生图、工作流素材上传）。
#[tauri::command]
pub async fn http_multipart(args: MultipartRequestArgs) -> Result<HttpResponsePayload, String> {
    let client = shared_client()?;
    let mut form = reqwest::multipart::Form::new();

    for field in args.fields {
        if let Some(raw) = field.data_base64 {
            let decoded = B64
                .decode(raw.as_bytes())
                .map_err(|e| format!("字段 {} 解码失败: {e}", field.name))?;
            let mut part = reqwest::multipart::Part::bytes(decoded);
            if let Some(file_name) = field.file_name {
                part = part.file_name(file_name);
            }
            if let Some(mime) = field.mime {
                part = part
                    .mime_str(&mime)
                    .map_err(|e| format!("字段 {} mime 无效: {e}", field.name))?;
            }
            form = form.part(field.name, part);
        } else if let Some(value) = field.value {
            form = form.text(field.name, value);
        }
    }

    let mut req = client
        .post(&args.url)
        .multipart(form)
        .timeout(request_timeout(args.timeout_ms));
    for h in &args.headers {
        if h.value.is_empty() {
            continue;
        }
        req = req.header(&h.name, &h.value);
    }

    let res = req.send().await.map_err(|e| describe_reqwest_error(&e))?;
    to_payload(res).await
}

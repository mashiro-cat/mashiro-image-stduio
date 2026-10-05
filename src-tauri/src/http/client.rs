//! reqwest 客户端的构建、超时策略、响应归一化与错误翻译。
//!
//! 这里只放「怎么发一个请求、怎么把响应变成前端好用的形状」，
//! 不含任何 `#[tauri::command]`（命令见 `super::commands`）。

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use std::sync::OnceLock;
use std::time::Duration;

use super::types::{HttpHeader, HttpResponsePayload};

/// 默认超时：生图 / 工作流这类任务动辄跑几分钟，
/// 不能沿用 reqwest 的短默认值，否则长任务会被我们自己掐断。
const DEFAULT_TIMEOUT_MS: u64 = 300_000;

/// 连接阶段的超时（秒）。连不上就该快速失败，而不是干等整个请求超时。
const CONNECT_TIMEOUT_SECS: u64 = 30;

const USER_AGENT: &str = "MashiroStudio/0.1.0";

/// 判断响应体能否当文本处理；不能的一律按 base64 透传（图片、zip 等）。
fn is_textual(content_type: &str) -> bool {
    let ct = content_type.to_ascii_lowercase();
    ct.is_empty()
        || ct.contains("json")
        || ct.contains("text")
        || ct.contains("xml")
        || ct.contains("javascript")
        || ct.contains("html")
        || ct.contains("urlencoded")
        || ct.contains("problem")
}

/// 全局共享的客户端。
///
/// `reqwest::Client` 内部持有连接池与 TLS 会话缓存，**一个实例才能复用**；
/// 每次请求都新建等于每次都重新 TCP + TLS 握手。工作流每 4 秒轮询一次、
/// 生成结果逐张下载，这笔开销非常实在。
///
/// 这里用 `OnceLock` 建一次就固定下来。客户端级超时设成 `DEFAULT_TIMEOUT_MS`
/// 作为兜底，逐请求的真实超时由 [`request_timeout`] 在 `RequestBuilder` 上覆盖——
/// `Client` 本身是 `Clone`（内部 `Arc`），克隆不复制连接池，可以随便传。
static SHARED_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

/// 取共享客户端。构建失败只在第一次发生（几乎只可能是 TLS 后端初始化问题），
/// 之后每次都直接拿到，不会反复付出构建代价。
pub(crate) fn shared_client() -> Result<&'static reqwest::Client, String> {
    if let Some(client) = SHARED_CLIENT.get() {
        return Ok(client);
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(DEFAULT_TIMEOUT_MS))
        .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("初始化 HTTP 客户端失败: {e}"))?;
    // 并发首次调用时可能重复构建一次，丢弃多余的那个即可（Client::get_or_init 保证最终一致）
    let _ = SHARED_CLIENT.set(client);
    SHARED_CLIENT
        .get()
        .ok_or_else(|| "初始化 HTTP 客户端失败: 客户端已被并发初始化".to_string())
}

/// 逐请求的超时。前端每次调用都可能给不同的 `timeoutMs`
/// （生图 300s、LLM 120s、图片下载 120s、连通测试 30s…），所以必须放在请求级。
pub(crate) fn request_timeout(timeout_ms: Option<u64>) -> Duration {
    Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS))
}

/// 把 reqwest 的响应收敛成前端契约：状态码、头、文本或 base64 正文。
pub(crate) async fn to_payload(res: reqwest::Response) -> Result<HttpResponsePayload, String> {
    let status = res.status();
    let headers: Vec<HttpHeader> = res
        .headers()
        .iter()
        .map(|(k, v)| HttpHeader {
            name: k.as_str().to_string(),
            value: v.to_str().unwrap_or_default().to_string(),
        })
        .collect();
    let content_type = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let bytes = res
        .bytes()
        .await
        .map_err(|e| format!("读取响应内容失败: {e}"))?;

    let textual = is_textual(&content_type);
    Ok(HttpResponsePayload {
        status: status.as_u16(),
        ok: status.is_success(),
        headers,
        body: if textual {
            String::from_utf8_lossy(&bytes).to_string()
        } else {
            B64.encode(&bytes)
        },
        is_base64: !textual,
    })
}

/// 把 reqwest 的英文错误翻译成用户能看懂的中文提示。
pub(crate) fn describe_reqwest_error(err: &reqwest::Error) -> String {
    if err.is_timeout() {
        "请求超时，请检查网络或调大超时时间".to_string()
    } else if err.is_connect() {
        format!("无法连接到服务：{}", err)
    } else if err.is_decode() {
        format!("响应解析失败：{}", err)
    } else {
        format!("请求失败：{}", err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_client_is_a_singleton() {
        // 复用连接池的前提：两次拿到的必须是同一个实例。
        // 一旦有人改回每次新建，这个断言会立刻失败。
        let a = shared_client().expect("首次构建应成功");
        let b = shared_client().expect("二次应直接命中缓存");
        assert!(std::ptr::eq(a, b), "共享客户端必须是同一实例");
    }

    #[test]
    fn request_timeout_falls_back_to_default() {
        assert_eq!(
            request_timeout(None),
            Duration::from_millis(DEFAULT_TIMEOUT_MS)
        );
    }

    #[test]
    fn request_timeout_overrides_per_request() {
        // 前端每个调用点的超时都不同（生图 300s / LLM 120s / 测试 30s）
        assert_eq!(request_timeout(Some(30_000)), Duration::from_millis(30_000));
        assert_eq!(
            request_timeout(Some(600_000)),
            Duration::from_millis(600_000)
        );
    }
}

//! 极简 HTTP/1.1 回环服务（Streamable HTTP 传输）。
//!
//! 为什么要自己写而不用 web 框架：这个端点只服务本机的几个 Agent 客户端，
//! 报文是几百字节的 JSON，且只在 `127.0.0.1` 上监听。
//! 为它引入 axum/hyper 全套会把依赖树拉长一大截，收益只是少写这 200 行。
//!
//! 实现范围（够用即止，但该有的都有）：
//! - `POST /mcp`：JSON-RPC 入口，支持单条与批量（数组）报文
//! - `Content-Length` 与 `Transfer-Encoding: chunked` 两种请求体
//! - `Authorization: Bearer <token>` 校验（令牌为空则跳过）
//! - 响应按客户端的 `Accept` 选择 `application/json` 或 SSE（`text/event-stream`）
//! - 通知类报文（无 `id`）按规范返回 `202 Accepted` 且不带响应体
//!
//! 刻意**不**实现 `GET /mcp`（服务端主动推送的 SSE 流）：本服务不需要主动推消息，
//! 按规范客户端在收到 405 后会退回 POST 模式。

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde_json::Value;
use tauri::AppHandle;

use super::bridge::BridgeHub;
use super::protocol;
use super::McpStats;

const MAX_BODY: usize = 8 * 1024 * 1024;

/// 服务句柄：持有停止标志与线程，`stop()` 会等线程真正退出后再返回，
/// 所以端口在 stop 之后立刻可以再次监听。
pub struct ServerHandle {
    pub port: u16,
    shutdown: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}

impl ServerHandle {
    pub fn stop(mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
        if let Some(handle) = self.thread.take() {
            let _ = handle.join();
        }
    }
}

/// 服务线程需要的一切
pub struct ServerCtx {
    pub app: AppHandle,
    pub hub: Arc<BridgeHub>,
    pub token: String,
    pub stats: Arc<Mutex<McpStats>>,
}

impl ServerCtx {
    pub fn record_request(&self) {
        let mut stats = self.stats.lock().expect("mcp stats lock");
        stats.request_count += 1;
        stats.last_request_at = super::now_ms();
        // 请求能进来就说明链路是通的，顺手清掉上一次的错误提示，
        // 免得界面上一直挂着一句已经过期的报错
        stats.last_error.clear();
    }

    pub fn record_call(&self) {
        self.stats.lock().expect("mcp stats lock").call_count += 1;
    }

    pub fn record_error(&self, message: &str) {
        self.stats.lock().expect("mcp stats lock").last_error = message.to_string();
    }
}

/// 启动服务。地址固定 `127.0.0.1`，不提供绑定到 0.0.0.0 的开关。
pub fn start(port: u16, ctx: Arc<ServerCtx>) -> Result<ServerHandle, String> {
    let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|e| match e.kind() {
        std::io::ErrorKind::AddrInUse => {
            format!("端口 {port} 已被占用，换一个端口再试（也可能是另一个 Mashiro Studio 实例正在运行）")
        }
        std::io::ErrorKind::PermissionDenied => {
            format!("没有权限监听端口 {port}，请换一个 1024 以上的端口")
        }
        _ => format!("无法监听 127.0.0.1:{port}：{e}"),
    })?;
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("设置监听模式失败：{e}"))?;

    let shutdown = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&shutdown);

    let thread = thread::spawn(move || {
        while !flag.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((stream, _)) => {
                    let ctx = Arc::clone(&ctx);
                    // 一个连接一个线程：这里的并发量级是个位数，不必上线程池
                    thread::spawn(move || handle_connection(stream, ctx));
                }
                Err(ref err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(60));
                }
                Err(_) => thread::sleep(Duration::from_millis(150)),
            }
        }
    });

    Ok(ServerHandle {
        port,
        shutdown,
        thread: Some(thread),
    })
}

/* ------------------------------------------------------------ 单个连接 */

fn handle_connection(mut stream: TcpStream, ctx: Arc<ServerCtx>) {
    // 监听套接字是非阻塞的，accepted 连接在部分平台会继承这个模式，显式改回来
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(30)));
    // 生成类工具要等几分钟才回包，写超时必须比它宽松
    let _ = stream.set_write_timeout(Some(Duration::from_secs(1800)));

    let Ok(reader_stream) = stream.try_clone() else {
        return;
    };
    let mut reader = BufReader::new(reader_stream);

    let mut request_line = String::new();
    if reader.read_line(&mut request_line).unwrap_or(0) == 0 {
        return;
    }
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_ascii_uppercase();
    let path = parts.next().unwrap_or("/").to_string();

    let mut headers: HashMap<String, String> = HashMap::new();
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).unwrap_or(0) == 0 {
            break;
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        if let Some((name, value)) = trimmed.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }

    if method != "POST" {
        let _ = respond(
            &mut stream,
            405,
            "application/json",
            &r#"{"error":"仅支持 POST /mcp（本服务不提供 GET 上的 SSE 推送，请改用 POST）"}"#,
            &[("Allow", "POST")],
        );
        return;
    }

    let clean_path = path.trim_end_matches('/');
    if clean_path != "/mcp" {
        let _ = respond(
            &mut stream,
            404,
            "application/json",
            &r#"{"error":"路径不存在，MCP 端点是 /mcp"}"#,
            &[],
        );
        return;
    }

    if !ctx.token.is_empty() && !authorized(&headers, &ctx.token) {
        ctx.record_error("令牌校验失败：客户端未带正确的 Authorization 头");
        let _ = respond(
            &mut stream,
            401,
            "application/json",
            &r#"{"error":"缺少或错误的访问令牌，请在本应用「设置 → MCP 服务」里重新复制客户端配置"}"#,
            &[("WWW-Authenticate", "Bearer")],
        );
        return;
    }

    let body = match read_body(&mut reader, &headers) {
        Ok(body) => body,
        Err(message) => {
            ctx.record_error(&message);
            let _ = respond(
                &mut stream,
                400,
                "application/json",
                &format!(r#"{{"error":{}}}"#, escape(&message)),
                &[],
            );
            return;
        }
    };

    ctx.record_request();

    let Ok(parsed) = serde_json::from_str::<Value>(&body) else {
        let _ = respond(
            &mut stream,
            400,
            "application/json",
            &format!(
                r#"{{"jsonrpc":"2.0","id":null,"error":{{"code":-32700,"message":{}}}}}"#,
                escape("请求体不是合法 JSON")
            ),
            &[],
        );
        return;
    };

    let payloads: Vec<Value> = match parsed {
        Value::Array(items) => items,
        other => vec![other],
    };

    let mut responses: Vec<Value> = Vec::new();
    for item in payloads {
        let is_notification = item.get("id").map(|id| id.is_null()).unwrap_or(true);
        if is_notification {
            // 目前没有需要处理的通知（initialized 等），按规范静默接受
            continue;
        }
        responses.push(protocol::handle_request(&ctx, &item));
    }

    if responses.is_empty() {
        let _ = respond(&mut stream, 202, "application/json", "", &[]);
        return;
    }

    let value = if responses.len() == 1 {
        responses.remove(0)
    } else {
        Value::Array(responses)
    };
    let text = serde_json::to_string(&value).unwrap_or_else(|_| "{}".to_string());

    // 客户端声明「只收 SSE」时才走 SSE；规范的客户端两个都声明，走 JSON 更省事
    let accept = headers.get("accept").cloned().unwrap_or_default();
    let sse_only = !accept.contains("application/json") && accept.contains("text/event-stream");
    if sse_only {
        let payload = format!("event: message\ndata: {text}\n\n");
        let _ = respond(&mut stream, 200, "text/event-stream", &payload, &[]);
    } else {
        let _ = respond(&mut stream, 200, "application/json", &text, &[]);
    }
}

fn authorized(headers: &HashMap<String, String>, token: &str) -> bool {
    let bearer = headers
        .get("authorization")
        .map(|value| {
            value
                .strip_prefix("Bearer ")
                .or_else(|| value.strip_prefix("bearer "))
                .unwrap_or(value)
                .trim()
                .to_string()
        })
        .or_else(|| headers.get("x-mcp-token").cloned())
        .unwrap_or_default();
    !bearer.is_empty() && bearer == token
}

/* ------------------------------------------------------------ 请求体 */

fn read_body<R: BufRead>(
    reader: &mut R,
    headers: &HashMap<String, String>,
) -> Result<String, String> {
    let chunked = headers
        .get("transfer-encoding")
        .map(|value| value.to_ascii_lowercase().contains("chunked"))
        .unwrap_or(false);
    if chunked {
        return read_chunked(reader);
    }

    let length: usize = headers
        .get("content-length")
        .and_then(|value| value.trim().parse().ok())
        .unwrap_or(0);
    if length == 0 {
        return Ok(String::new());
    }
    if length > MAX_BODY {
        return Err(format!("请求体过大（{length} 字节），已拒绝"));
    }
    let mut buffer = vec![0u8; length];
    reader
        .read_exact(&mut buffer)
        .map_err(|e| format!("读取请求体失败：{e}"))?;
    Ok(String::from_utf8_lossy(&buffer).to_string())
}

/// Node 系客户端（Cursor / Kimi）在流式发送时可能用 chunked，这里一并支持
fn read_chunked<R: BufRead>(reader: &mut R) -> Result<String, String> {
    let mut out: Vec<u8> = Vec::new();
    let mut line = String::new();
    loop {
        line.clear();
        if reader
            .read_line(&mut line)
            .map_err(|e| format!("读取分块长度失败：{e}"))?
            == 0
        {
            break;
        }
        let size_text = line
            .trim()
            .split(';')
            .next()
            .unwrap_or("0")
            .trim()
            .to_string();
        let size = usize::from_str_radix(&size_text, 16)
            .map_err(|_| format!("分块长度不合法：{size_text}"))?;
        if size == 0 {
            // 吃掉 trailer，直到空行
            loop {
                line.clear();
                if reader.read_line(&mut line).unwrap_or(0) == 0 || line.trim().is_empty() {
                    break;
                }
            }
            break;
        }
        if out.len() + size > MAX_BODY {
            return Err("请求体过大，已拒绝".to_string());
        }
        let mut buffer = vec![0u8; size];
        reader
            .read_exact(&mut buffer)
            .map_err(|e| format!("读取分块内容失败：{e}"))?;
        out.extend_from_slice(&buffer);
        line.clear();
        let _ = reader.read_line(&mut line);
    }
    Ok(String::from_utf8_lossy(&out).to_string())
}

/* ------------------------------------------------------------ 响应 */

fn respond(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: &str,
    extra: &[(&str, &str)],
) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        202 => "Accepted",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Error",
    };
    // 显式带 charset：JSON 按规范本就是 UTF-8，但部分客户端（含 PowerShell 的
    // Invoke-WebRequest）在没有 charset 时会按 Latin-1 解码，中文回包就成乱码
    let mut head = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n",
        body.as_bytes().len()
    );
    for (name, value) in extra {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str("\r\n");

    stream.write_all(head.as_bytes())?;
    if !body.is_empty() {
        stream.write_all(body.as_bytes())?;
    }
    stream.flush()?;
    let _ = stream.shutdown(std::net::Shutdown::Write);
    Ok(())
}

/// 把字符串包成 JSON 字符串字面量（错误消息里可能有引号）
fn escape(text: &str) -> String {
    serde_json::to_string(text).unwrap_or_else(|_| "\"\"".to_string())
}

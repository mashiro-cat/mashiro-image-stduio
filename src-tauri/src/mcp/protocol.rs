//! JSON-RPC 2.0 与 MCP 方法分发。
//!
//! 只实现 MCP 协议的 `tools` 部分（与 Codex 一致：它也只支持 tools）：
//! `initialize` / `ping` / `tools/list` / `tools/call`，另外把
//! `resources/list`、`prompts/list` 以空列表回掉——部分客户端会无条件先探一遍。

use serde_json::{json, Value};

use super::bridge::BridgeReply;
use super::server::ServerCtx;
use super::tools;
use super::{SERVER_NAME, SERVER_VERSION};

/// 认识这几个版本的协商结果；客户端提的版本不在表里就回最新版
const KNOWN_VERSIONS: [&str; 3] = ["2024-11-05", "2025-03-26", "2025-06-18"];
const LATEST_VERSION: &str = "2025-06-18";

/// 服务级说明。Codex 会把前 512 字符当作「决定要不要用这些工具」的上下文，
/// 所以最重要的约束（会花额度、返回的是本地路径、先查能力）放最前面。
const INSTRUCTIONS: &str = "\
Mashiro Studio 是本机运行的 AI 生图工作台，这些工具会让真实的生图渠道产生消耗。
先用 mashiro_list_capabilities 确认可用的渠道、模型与工作流，再调用生成类工具，避免猜错模型名或工作流名。
生成结果已经落盘，工具返回的是图片的本地绝对路径，可以直接读取或继续用于 mashiro_edit_image / mashiro_run_workflow。
生图通常需要 30~120 秒（工作流可能更久），属于正常耗时，请等待返回而不是重试。
如果报错提示未配置渠道或密钥，请让用户在 Mashiro Studio 的「设置 → 生图渠道 / 工作流渠道」里补全配置。";

/// 处理一条请求，返回可直接写回客户端的响应对象（`id` 原样回传）。
pub fn handle_request(ctx: &ServerCtx, request: &Value) -> Value {
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let method = request.get("method").and_then(|v| v.as_str()).unwrap_or("");
    let params = request.get("params").cloned().unwrap_or(Value::Null);

    match dispatch(ctx, method, &params) {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err(error) => json!({ "jsonrpc": "2.0", "id": id, "error": error }),
    }
}

fn dispatch(ctx: &ServerCtx, method: &str, params: &Value) -> Result<Value, Value> {
    match method {
        "initialize" => Ok(initialize(params)),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tools::definitions() })),
        "tools/call" => call_tool(ctx, params),
        // 未声明对应能力，但客户端可能先探一遍；给空列表比报错更友好
        "resources/list" => Ok(json!({ "resources": [] })),
        "resources/templates/list" => Ok(json!({ "resourceTemplates": [] })),
        "prompts/list" => Ok(json!({ "prompts": [] })),
        other => Err(rpc_error(-32601, &format!("不支持的方法：{other}"))),
    }
}

fn initialize(params: &Value) -> Value {
    let requested = params
        .get("protocolVersion")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let version = if KNOWN_VERSIONS.contains(&requested) {
        requested
    } else {
        LATEST_VERSION
    };

    json!({
        "protocolVersion": version,
        "capabilities": { "tools": { "listChanged": false } },
        "serverInfo": { "name": SERVER_NAME, "version": SERVER_VERSION },
        "instructions": INSTRUCTIONS
    })
}

fn call_tool(ctx: &ServerCtx, params: &Value) -> Result<Value, Value> {
    let name = params
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    let Some(timeout) = tools::timeout_of(&name) else {
        return Err(rpc_error(-32602, &format!("未知工具：{name}")));
    };

    let args = match params.get("arguments") {
        Some(Value::Object(map)) => Value::Object(map.clone()),
        Some(Value::Null) | None => json!({}),
        Some(_) => return Err(rpc_error(-32602, "arguments 必须是对象")),
    };

    ctx.record_call();

    // 参数校验（必填、枚举、范围）放在渲染层：那里能同时看到渠道配置，
    // 报错可以带上「该去设置页改哪一项」，比在这里干巴巴地说缺参数有用得多。
    match ctx.hub.call(&ctx.app, &name, args, timeout) {
        Ok(reply) => Ok(tool_result(&reply)),
        Err(message) => {
            ctx.record_error(&message);
            Ok(json!({
                "content": [{ "type": "text", "text": message }],
                "isError": true
            }))
        }
    }
}

/// 组装工具结果：第一段是给模型读的结论，第二段（有的话）是结构化数据便于精确取值。
fn tool_result(reply: &BridgeReply) -> Value {
    let mut content = vec![json!({
        "type": "text",
        "text": if reply.text.trim().is_empty() {
            if reply.ok { "已完成".to_string() } else { "执行失败".to_string() }
        } else {
            reply.text.clone()
        }
    })];

    if let Some(data) = &reply.data {
        if let Ok(text) = serde_json::to_string_pretty(data) {
            content.push(json!({ "type": "text", "text": format!("结构化结果：\n{text}") }));
        }
    }

    json!({ "content": content, "isError": !reply.ok })
}

fn rpc_error(code: i64, message: &str) -> Value {
    json!({ "code": code, "message": message })
}

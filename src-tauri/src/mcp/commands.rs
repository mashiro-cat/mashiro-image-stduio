//! 前端 IPC 命令。
//!
//! 命令名与参数名是公开契约：`src/platform/mcp.ts` 按名字 invoke，改名要同步前端。
//! 所有错误都是面向用户的一句话，前端可以直接展示。

use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use super::bridge::BridgeReply;
use super::clients::{self, ApplyResult, ClientInfo};
use super::server::ServerCtx;
use super::{save_config, tools, McpState, DEFAULT_PORT, SERVER_NAME, SERVER_VERSION};

/// 服务状态快照
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub running: bool,
    pub port: u16,
    pub url: String,
    pub token: String,
    /// 渲染层是否已挂上监听（决定工具调用能不能真正执行）
    pub bridge_ready: bool,
    pub started_at: u64,
    pub request_count: u64,
    pub call_count: u64,
    pub last_request_at: u64,
    pub last_error: String,
    pub tool_count: usize,
    pub server_name: &'static str,
    pub version: &'static str,
}

fn snapshot(state: &McpState) -> McpStatus {
    let config = state.config.lock().expect("mcp config lock").clone();
    let stats = state.stats.lock().expect("mcp stats lock").clone();
    // 报「实际在听的端口」而不是配置值：改端口时若被占用，两者会不一致，
    // 界面显示配置值会让人以为改成功了
    let port = state.bound_port(config.port);
    let url = format!("http://127.0.0.1:{port}/mcp");
    McpStatus {
        running: state.is_running(),
        port,
        url,
        token: config.token,
        bridge_ready: state.hub.is_ready(),
        started_at: stats.started_at,
        request_count: stats.request_count,
        call_count: stats.call_count,
        last_request_at: stats.last_request_at,
        last_error: stats.last_error,
        tool_count: tools::definitions().len(),
        server_name: SERVER_NAME,
        version: SERVER_VERSION,
    }
}

/// 真正起服务。重复调用是幂等的。
fn boot(app: &AppHandle, state: &McpState) -> Result<(), String> {
    let mut guard = state.server.lock().expect("mcp server lock");
    if guard.is_some() {
        return Ok(());
    }

    let config = state.config.lock().expect("mcp config lock").clone();
    let ctx = Arc::new(ServerCtx {
        app: app.clone(),
        hub: Arc::clone(&state.hub),
        token: config.token.clone(),
        stats: Arc::clone(&state.stats),
    });

    let handle = super::server::start(config.port, ctx)?;
    {
        let mut stats = state.stats.lock().expect("mcp stats lock");
        stats.started_at = super::now_ms();
        stats.last_error.clear();
    }
    *guard = Some(handle);
    Ok(())
}

fn halt(state: &McpState) {
    let handle = state.server.lock().expect("mcp server lock").take();
    if let Some(handle) = handle {
        handle.stop();
    }
    let mut stats = state.stats.lock().expect("mcp stats lock");
    stats.started_at = 0;
}

/// 应用启动时按上次的配置自动恢复服务。
/// 恢复失败只把原因记进状态里，不弹错——用户没主动做任何操作，不该被打断。
pub fn autostart(app: &AppHandle) {
    let Some(state) = app.try_state::<McpState>() else {
        return;
    };
    if !state.config.lock().expect("mcp config lock").enabled {
        return;
    }
    if let Err(err) = boot(app, &state) {
        state.stats.lock().expect("mcp stats lock").last_error = err;
    }
}

/* ------------------------------------------------------------ 服务控制 */

#[tauri::command]
pub fn mcp_status(state: State<'_, McpState>) -> Result<McpStatus, String> {
    Ok(snapshot(&state))
}

#[tauri::command]
pub fn mcp_start(
    app: AppHandle,
    state: State<'_, McpState>,
    port: Option<u16>,
) -> Result<McpStatus, String> {
    if let Some(port) = port {
        if port != 0 {
            state.config.lock().expect("mcp config lock").port = port;
        }
    }
    state.config.lock().expect("mcp config lock").enabled = true;
    boot(&app, &state)?;
    let config = state.config.lock().expect("mcp config lock").clone();
    save_config(&app, &config)?;
    Ok(snapshot(&state))
}

#[tauri::command]
pub fn mcp_stop(app: AppHandle, state: State<'_, McpState>) -> Result<McpStatus, String> {
    state.config.lock().expect("mcp config lock").enabled = false;
    halt(&state);
    let config = state.config.lock().expect("mcp config lock").clone();
    save_config(&app, &config)?;
    Ok(snapshot(&state))
}

/// 改端口 / 轮换令牌。服务开着的话按新参数重启，避免「改了没生效」的迷惑。
#[tauri::command]
pub fn mcp_configure(
    app: AppHandle,
    state: State<'_, McpState>,
    port: Option<u16>,
    rotate_token: Option<bool>,
) -> Result<McpStatus, String> {
    let was_running = state.is_running();
    let next_port = {
        let mut config = state.config.lock().expect("mcp config lock");
        if let Some(port) = port {
            if port != 0 {
                config.port = port;
            }
        }
        if rotate_token.unwrap_or(false) {
            config.token = super::random_token();
        }
        config.clone()
    };

    if next_port.port == 0 {
        return Err(format!(
            "端口不能为 0，请填写 1024 以上的端口（默认 {DEFAULT_PORT}）"
        ));
    }
    save_config(&app, &next_port)?;

    if was_running {
        halt(&state);
        // 新端口若被占用，这里会把服务留在停止状态并把原因交给用户，
        // 比「看起来在跑其实没在跑」要好
        boot(&app, &state)?;
    }
    Ok(snapshot(&state))
}

/* ------------------------------------------------------------ 与渲染层交互 */

/// 渲染层挂上/摘掉监听
#[tauri::command]
pub fn mcp_bridge_ready(state: State<'_, McpState>, ready: bool) {
    state.hub.set_ready(ready);
}

/// 渲染层交回工具执行结果
#[tauri::command]
pub fn mcp_respond(
    state: State<'_, McpState>,
    id: String,
    ok: bool,
    text: String,
    data: Option<Value>,
) -> bool {
    state.hub.respond(&id, BridgeReply { ok, text, data })
}

/* ------------------------------------------------------------ 客户端配置 */

/// 本服务对外暴露的工具清单（设置页展示用）
#[tauri::command]
pub fn mcp_tools() -> Vec<tools::ToolBrief> {
    tools::briefs()
}

#[tauri::command]
pub fn mcp_clients(app: AppHandle, state: State<'_, McpState>) -> Vec<ClientInfo> {
    let config = state.config.lock().expect("mcp config lock").clone();
    let url = config.url();
    clients::TARGETS
        .iter()
        .map(|target| clients::info(&app, target, &url, &config.token))
        .collect()
}

#[tauri::command]
pub fn mcp_apply_client(
    app: AppHandle,
    state: State<'_, McpState>,
    client_id: String,
) -> Result<ApplyResult, String> {
    let target = clients::find(&client_id).ok_or_else(|| format!("未知客户端：{client_id}"))?;
    let config = state.config.lock().expect("mcp config lock").clone();
    clients::apply(&app, target, &config.url(), &config.token)
}

#[tauri::command]
pub fn mcp_remove_client(app: AppHandle, client_id: String) -> Result<ApplyResult, String> {
    let target = clients::find(&client_id).ok_or_else(|| format!("未知客户端：{client_id}"))?;
    clients::remove(&app, target)
}

/// 在文件管理器里定位客户端配置文件（不存在就把所在目录建出来再定位）
#[tauri::command]
pub fn mcp_reveal_client_config(app: AppHandle, client_id: String) -> Result<(), String> {
    let target = clients::find(&client_id).ok_or_else(|| format!("未知客户端：{client_id}"))?;
    let info = {
        let config = super::load_config(&app);
        clients::info(&app, target, &config.url(), &config.token)
    };
    let path = std::path::PathBuf::from(&info.path);
    if info.exists {
        return crate::system::reveal::reveal_in_folder(info.path.clone());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
        return crate::system::reveal::reveal_in_folder(parent.to_string_lossy().to_string());
    }
    Err("无法定位该客户端的配置文件路径".to_string())
}

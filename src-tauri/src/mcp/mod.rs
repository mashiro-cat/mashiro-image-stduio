//! MCP 服务域：把本应用的生图能力按 MCP（Model Context Protocol）暴露给外部 Agent 客户端。
//!
//! # 分工
//!
//! 本域**只负责「协议 + 传输」**：在回环地址上起一个 Streamable HTTP 服务，
//! 解析 JSON-RPC，校验令牌，把 `tools/call` 转发给渲染层，再把结果原样写回。
//! **真正的生图能力留在前端**（`src/services/mcpBridge.ts`）——那里已经有渠道配置、
//! 结果落盘、历史记录，在 Rust 里重写一遍只会产出两套会各自漂移的实现。
//!
//! ```text
//! Agent 客户端 ──HTTP(127.0.0.1)──▶ server.rs ──▶ protocol.rs ──▶ bridge.rs
//!                                                                   │ emit 事件
//!                                                                   ▼
//!                                              src/services/mcpBridge.ts（复用生图链路）
//!                                                                   │ mcp_respond
//!                                                                   ▼
//! Agent 客户端 ◀──────────────────── 工具结果 ───────────────────────┘
//! ```
//!
//! # 文件职责
//!
//! - [`server`]：极简 HTTP/1.1 回环服务（只用 std，不为此引入 web 框架依赖）
//! - [`protocol`]：JSON-RPC 2.0 与 MCP 方法分发（initialize / tools.list / tools.call）
//! - [`tools`]：对外暴露的工具清单；schema 即前端契约，改名前先看 `mcpBridge.ts`
//! - [`bridge`]：调用 → 渲染层 → 回执 的等待与超时
//! - [`clients`]：把服务地址写进各家 Agent 客户端（Codex / Kimi / WorkBuddy / Cursor…）的配置文件
//! - [`commands`]：前端 IPC 命令（启停 / 状态 / 配置客户端 / 回执）
//!
//! # 约定
//!
//! - **只监听 `127.0.0.1`**：MCP 能让外部模型花掉用户的 API 额度，绝不能顺带暴露到局域网。
//! - 默认带 `Authorization: Bearer <token>` 校验；令牌存在 `store/mcp.json`，可一键轮换。
//! - 客户端配置写在用户主目录下的固定路径表（[`clients::TARGETS`]）里，
//!   **前端只能传客户端 id，不能传路径**——否则这里就成了任意文件写入的后门。

pub(crate) mod bridge;
pub(crate) mod clients;
pub(crate) mod commands;
pub(crate) mod protocol;
pub(crate) mod server;
pub(crate) mod tools;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::fs::paths::data_root;

/// 默认端口。改了要同步 README 与客户端配置样例。
pub const DEFAULT_PORT: u16 = 8737;
/// 服务名，同时用作各家客户端配置里的条目名
pub const SERVER_NAME: &str = "mashiro-studio";
pub const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

/// MCP 服务配置（持久化在 `store/mcp.json`）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConfig {
    /// 是否开启。开启后下次启动应用会自动恢复，不需要记得手动再点一次
    pub enabled: bool,
    pub port: u16,
    /// 访问令牌。为空表示不校验（仅当服务只监听回环地址时才有意义）
    pub token: String,
}

impl Default for McpConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            port: DEFAULT_PORT,
            token: random_token(),
        }
    }
}

impl McpConfig {
    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}/mcp", self.port)
    }
}

/// 运行时统计（只在内存里，重启归零）
#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStats {
    pub started_at: u64,
    pub request_count: u64,
    pub last_request_at: u64,
    pub call_count: u64,
    pub last_error: String,
}

/// 全局运行时状态。`hub` 与 `stats` 用 `Arc` 是为了让服务线程与命令线程共享同一份。
pub struct McpState {
    pub config: Mutex<McpConfig>,
    pub hub: Arc<bridge::BridgeHub>,
    pub server: Mutex<Option<server::ServerHandle>>,
    pub stats: Arc<Mutex<McpStats>>,
}

impl McpState {
    pub fn new(config: McpConfig) -> Self {
        Self {
            config: Mutex::new(config),
            hub: Arc::new(bridge::BridgeHub::new()),
            server: Mutex::new(None),
            stats: Arc::new(Mutex::new(McpStats::default())),
        }
    }

    pub fn is_running(&self) -> bool {
        self.server.lock().expect("mcp server lock").is_some()
    }

    /// 实际在监听的端口（服务未运行时退回配置里的端口）
    pub fn bound_port(&self, fallback: u16) -> u16 {
        self.server
            .lock()
            .expect("mcp server lock")
            .as_ref()
            .map(|handle| handle.port)
            .unwrap_or(fallback)
    }
}

/* ------------------------------------------------------------ 配置落盘 */

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_root(app)?.join("store").join("mcp.json"))
}

/// 读取配置。文件缺失或损坏都退回默认值——服务配置坏掉不该让应用起不来。
pub fn load_config(app: &AppHandle) -> McpConfig {
    let Ok(path) = config_path(app) else {
        return McpConfig::default();
    };
    let Ok(text) = std::fs::read_to_string(&path) else {
        return McpConfig::default();
    };
    // 去 BOM：Windows 上不少编辑器（以及 PowerShell 的 `Set-Content -Encoding utf8`）
    // 会写 UTF-8 BOM，serde_json 认不出来，会让配置整体退回默认值——
    // 表现为「明明开了服务，重启后又变成关的，令牌还换了」。
    let text = text.trim_start_matches('\u{feff}');
    let mut config: McpConfig = serde_json::from_str(text).unwrap_or_default();
    if config.port == 0 {
        config.port = DEFAULT_PORT;
    }
    if config.token.trim().is_empty() {
        config.token = random_token();
    }
    config
}

pub fn save_config(app: &AppHandle, config: &McpConfig) -> Result<(), String> {
    let path = config_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
    }
    let text = serde_json::to_string_pretty(config).map_err(|e| format!("序列化配置失败: {e}"))?;
    std::fs::write(&path, text).map_err(|e| format!("写入 MCP 配置失败: {e}"))
}

/* ------------------------------------------------------------ 工具函数 */

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 生成访问令牌。
///
/// 用 `RandomState`（内部由操作系统熵源播种、且每次实例化都不同）做哈希，
/// 而不是为此引入 `rand`：本地回环地址上的令牌不需要密码学强度，
/// 但必须「猜不出来」，所以拼四轮哈希取 32 位十六进制。
pub fn random_token() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};

    let mut out = String::with_capacity(32);
    for round in 0..2u64 {
        let state = RandomState::new();
        let mut hasher = state.build_hasher();
        hasher.write_u64(round);
        hasher.write_u64(now_ms());
        out.push_str(&format!("{:016x}", hasher.finish()));
    }
    out
}

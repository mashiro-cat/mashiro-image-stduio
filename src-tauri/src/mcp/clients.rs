//! 把 MCP 服务写进各家 Agent 客户端的配置文件。
//!
//! # 安全边界
//!
//! 这里会写用户主目录下的文件，**刻意不接受任何来自前端的路径**：
//! 前端只能传客户端 `id`，落点由本文件的 [`TARGETS`] 表决定。
//! 否则这个命令就成了「任意文件写入」的后门。
//!
//! 两套写法，对应两类客户端：
//! - **JSON**（WorkBuddy / Claude Code / Cursor / Kimi / VS Code）：就地合并一个键，
//!   保留用户其它配置；文件不是合法 JSON 时**拒绝改写**，而不是粗暴覆盖。
//! - **TOML**（Codex）：不解析整个文件，只在末尾维护一段带标记的块，
//!   用户自己的配置一个字符都不动。
//!
//! 还有一类**只支持 stdio** 的客户端（Claude Desktop）：生成 `npx mcp-remote` 桥接配置，
//! 由它把 stdio 转成本地 HTTP。这类会在 [`ClientInfo::needs_node`] 上标出来。

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager};

use super::SERVER_NAME;

/// 配置文件格式
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    /// JSON：指定根键（`mcpServers` / `servers`）
    Json { root: &'static str },
    /// Codex 的 config.toml：维护一段带标记的 TOML 块
    Toml,
}

/// 客户端的一张表。**加客户端 = 加一行**，不要在别处写 if/else。
#[derive(Debug, Clone, Copy)]
pub struct Target {
    pub id: &'static str,
    pub name: &'static str,
    /// 相对用户主目录的候选路径，取第一个存在的；都不存在时用第一个
    pub home_paths: &'static [&'static str],
    /// 相对系统配置目录（Windows 为 %APPDATA%）的候选路径
    pub config_paths: &'static [&'static str],
    pub format: Format,
    /// 写进 `type` 字段的值；`None` 表示不写这个字段
    pub http_type: Option<&'static str>,
    /// Kimi 需要的 `transport` 字段
    pub transport: Option<&'static str>,
    /// 该客户端只支持 stdio，需要 npx 桥接（本机要有 Node.js）
    pub stdio_bridge: bool,
    /// 界面上展示的一句话说明（写在哪、要不要重启）
    pub note: &'static str,
    pub homepage: &'static str,
}

pub const TARGETS: &[Target] = &[
    Target {
        id: "workbuddy",
        name: "WorkBuddy",
        home_paths: &[".workbuddy/mcp.json"],
        config_paths: &[],
        format: Format::Json { root: "mcpServers" },
        http_type: Some("http"),
        transport: None,
        stdio_bridge: false,
        note: "写入用户级 mcp.json。配置后需在 WorkBuddy 的「连接器管理」里点一次「信任」才会启用。",
        homepage: "https://www.workbuddy.cn/docs/workbuddy/Overview",
    },
    Target {
        id: "codex",
        name: "Codex CLI",
        home_paths: &[".codex/config.toml"],
        config_paths: &[],
        format: Format::Toml,
        http_type: None,
        transport: None,
        stdio_bridge: false,
        note: "写入 ~/.codex/config.toml 末尾的独立段落并放宽工具超时（生图较慢，Codex 默认 60 秒会提前断开）。改完需新开一个会话。",
        homepage: "https://developers.openai.com/codex/mcp",
    },
    Target {
        id: "claude-code",
        name: "Claude Code",
        home_paths: &[".claude.json"],
        config_paths: &[],
        format: Format::Json { root: "mcpServers" },
        http_type: Some("http"),
        transport: None,
        stdio_bridge: false,
        note: "写入用户级 ~/.claude.json（该文件较大，改写前会先备份一份 .mashiro.bak）。也可改用命令 claude mcp add --transport http。",
        homepage: "https://docs.claude.com/en/docs/claude-code/mcp",
    },
    Target {
        id: "kimi",
        name: "Kimi Code CLI",
        home_paths: &[".kimi-code/mcp.json", ".kimi/mcp.json"],
        config_paths: &[],
        format: Format::Json { root: "mcpServers" },
        http_type: None,
        transport: Some("http"),
        stdio_bridge: false,
        note: "优先写入 ~/.kimi-code/mcp.json；若你已在用旧版 ~/.kimi/mcp.json 则写后者。可在 TUI 里用 /mcp 查看连接状态。",
        homepage: "https://www.kimi.com/code/docs/kimi-code-cli/customization/mcp.html",
    },
    Target {
        id: "cursor",
        name: "Cursor",
        home_paths: &[".cursor/mcp.json"],
        config_paths: &[],
        format: Format::Json { root: "mcpServers" },
        http_type: None,
        transport: None,
        stdio_bridge: false,
        note: "写入全局 ~/.cursor/mcp.json，对所有项目生效；改完到 Settings → MCP 里能看到已连接。",
        homepage: "https://docs.cursor.com/context/model-context-protocol",
    },
    Target {
        id: "vscode",
        name: "VS Code",
        home_paths: &[],
        config_paths: &["Code/User/mcp.json"],
        format: Format::Json { root: "servers" },
        http_type: Some("http"),
        transport: None,
        stdio_bridge: false,
        note: "写入 VS Code 用户级 MCP 配置（注意根键是 servers 而不是 mcpServers）。可用命令面板的 MCP: List Servers 核对。",
        homepage: "https://code.visualstudio.com/docs/copilot/chat/mcp-servers",
    },
    Target {
        id: "claude-desktop",
        name: "Claude Desktop",
        home_paths: &[],
        config_paths: &["Claude/claude_desktop_config.json"],
        format: Format::Json { root: "mcpServers" },
        http_type: None,
        transport: None,
        stdio_bridge: true,
        note: "桌面端只支持 stdio，这里写入的是 npx mcp-remote 桥接配置，因此本机需要安装 Node.js。",
        homepage: "https://modelcontextprotocol.io/docs/develop/connect-local-servers",
    },
];

pub fn find(id: &str) -> Option<&'static Target> {
    TARGETS.iter().find(|target| target.id == id)
}

/// 检测结果 + 配置预览，直接喂给设置页
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientInfo {
    pub id: &'static str,
    pub name: &'static str,
    /// 只在磁盘上看到了该客户端的配置目录 / 文件
    pub detected: bool,
    /// 配置文件里已经有本应用的条目了
    pub configured: bool,
    /// 实际（或将要）写入的绝对路径
    pub path: String,
    pub exists: bool,
    pub note: &'static str,
    pub homepage: &'static str,
    pub stdio_bridge: bool,
    /// 将要写入的配置片段（命令行客户端可直接照着贴 / 复制）
    pub preview: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub path: String,
    pub message: String,
}

/* ------------------------------------------------------------ 路径解析 */

/// 解析落点。候选里**已存在的优先**，都不存在就用第一个候选。
fn resolve(app: &AppHandle, target: &Target) -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if !target.home_paths.is_empty() {
        let home = app
            .path()
            .home_dir()
            .map_err(|e| format!("无法定位用户主目录：{e}"))?;
        candidates.extend(target.home_paths.iter().map(|rel| home.join(rel)));
    }
    if !target.config_paths.is_empty() {
        let config = app
            .path()
            .config_dir()
            .map_err(|e| format!("无法定位系统配置目录：{e}"))?;
        candidates.extend(target.config_paths.iter().map(|rel| config.join(rel)));
    }

    if candidates.is_empty() {
        return Err(format!("{} 没有配置落点记录", target.name));
    }
    if let Some(existing) = candidates.iter().find(|path| path.exists()) {
        return Ok(existing.clone());
    }
    Ok(candidates.remove(0))
}

fn is_detected(target: &Target, path: &Path) -> bool {
    if path.exists() {
        return true;
    }
    // 只看「有子目录」的候选：`~/.claude.json` 的父目录是主目录本身，
    // 拿它当依据会让所有客户端都显示成「已检测到」
    let relative = target
        .home_paths
        .iter()
        .chain(target.config_paths.iter())
        .find(|rel| path.ends_with(Path::new(rel).file_name().unwrap_or_default()));
    let Some(relative) = relative else {
        return false;
    };
    if !relative.contains('/') {
        return false;
    }
    path.parent().map(|dir| dir.exists()).unwrap_or(false)
}

/* ------------------------------------------------------------ 片段生成 */

fn http_entry(target: &Target, url: &str, token: &str) -> Value {
    let mut entry = Map::new();
    if let Some(kind) = target.http_type {
        entry.insert("type".to_string(), json!(kind));
    }
    entry.insert("url".to_string(), json!(url));
    if let Some(transport) = target.transport {
        entry.insert("transport".to_string(), json!(transport));
    }
    if !token.is_empty() {
        let mut headers = Map::new();
        headers.insert(
            "Authorization".to_string(),
            json!(format!("Bearer {token}")),
        );
        entry.insert("headers".to_string(), Value::Object(headers));
    }
    Value::Object(entry)
}

fn stdio_entry(url: &str, token: &str) -> Value {
    let mut args = vec![json!("-y"), json!("mcp-remote"), json!(url)];
    if !token.is_empty() {
        args.push(json!("--header"));
        args.push(json!(format!("Authorization: Bearer {token}")));
    }
    json!({ "command": "npx", "args": args })
}

fn entry_of(target: &Target, url: &str, token: &str) -> Value {
    if target.stdio_bridge {
        stdio_entry(url, token)
    } else {
        http_entry(target, url, token)
    }
}

/// Codex 那段 TOML 的标记行：靠它们做「可重复写入且不碰用户其它配置」
const BLOCK_BEGIN: &str = "# >>> mashiro-studio (由 Mashiro Studio 写入，请勿手动修改本段) >>>";

fn toml_block(url: &str, token: &str) -> String {
    let mut block = String::new();
    block.push_str(BLOCK_BEGIN);
    block.push('\n');
    block.push_str(&format!("[mcp_servers.{SERVER_NAME}]\n"));
    block.push_str(&format!("url = \"{url}\"\n"));
    if !token.is_empty() {
        block.push_str(&format!(
            "http_headers = {{ Authorization = \"Bearer {token}\" }}\n"
        ));
    }
    // Codex 默认工具超时 60 秒，而生图经常要 1~2 分钟，不放开会被它中途放弃
    block.push_str("tool_timeout_sec = 900\n");
    block.push_str("# <<< mashiro-studio <<<");
    block
}

/// 生成将要写入的片段文本（设置页上直接展示 + 复制用）
pub fn preview(target: &Target, url: &str, token: &str) -> String {
    match target.format {
        Format::Toml => toml_block(url, token),
        Format::Json { root } => {
            let entry = serde_json::to_string_pretty(&entry_of(target, url, token))
                .unwrap_or_else(|_| "{}".to_string());
            format!(
                "{{\n  \"{root}\": {{\n    \"{SERVER_NAME}\": {}\n  }}\n}}",
                indent(&entry, 4)
            )
        }
    }
}

/// 把多行文本整体再缩进一层，让示例看着像真的嵌在根对象里
fn indent(text: &str, spaces: usize) -> String {
    let pad = " ".repeat(spaces);
    let mut lines = text.lines();
    let mut out = match lines.next() {
        Some(first) => first.to_string(),
        None => String::new(),
    };
    for line in lines {
        out.push('\n');
        out.push_str(&pad);
        out.push_str(line);
    }
    out
}

/* ------------------------------------------------------------ 读写 */

fn backup(path: &Path) {
    if !path.exists() {
        return;
    }
    let backup_path = path.with_extension(format!(
        "{}mashiro.bak",
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| format!("{ext}."))
            .unwrap_or_default()
    ));
    // 只留一份首次改写前的备份，避免反复操作堆出一堆 .bak
    if !backup_path.exists() {
        let _ = std::fs::copy(path, backup_path);
    }
}

fn read_text(path: &Path) -> Result<String, String> {
    if !path.exists() {
        return Ok(String::new());
    }
    let text =
        std::fs::read_to_string(path).map_err(|e| format!("读取 {} 失败：{e}", path.display()))?;
    // 去 BOM：Windows 上的编辑器（含 PowerShell 的 Set-Content -Encoding utf8）
    // 常写 UTF-8 BOM，而 serde_json 不认，会把好文件判成「不是合法 JSON」而拒绝写入
    Ok(text.trim_start_matches('\u{feff}').to_string())
}

fn write_text(path: &Path, text: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    std::fs::write(path, text).map_err(|e| format!("写入 {} 失败：{e}", path.display()))
}

fn parse_json(path: &Path) -> Result<Value, String> {
    let text = read_text(path)?;
    if text.trim().is_empty() {
        return Ok(json!({}));
    }
    serde_json::from_str(&text).map_err(|e| {
        format!(
            "{} 不是合法 JSON（{e}）。为避免覆盖你已有的配置，本次不做改写——请先修好该文件，或按下方片段手动添加。",
            path.display()
        )
    })
}

fn json_is_configured(path: &Path, root: &str) -> bool {
    let Ok(value) = parse_json(path) else {
        return false;
    };
    value
        .get(root)
        .and_then(|servers| servers.get(SERVER_NAME))
        .is_some()
}

/// TOML 的标记块是否在文件里
fn toml_has_block(text: &str) -> bool {
    text.contains(BLOCK_BEGIN)
}

/// 去掉旧的标记块（含标记行本身），返回剩余内容
fn strip_toml_block(text: &str) -> String {
    let mut out = String::new();
    let mut inside = false;
    for line in text.lines() {
        if line.trim_start().starts_with(BLOCK_BEGIN) {
            inside = true;
            continue;
        }
        if inside {
            if line.trim_start().starts_with("# <<< mashiro-studio") {
                inside = false;
            }
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }
    out
}

/* ------------------------------------------------------------ 对外入口 */

/// 检测 + 预览，直接喂给设置页
pub fn info(app: &AppHandle, target: &Target, url: &str, token: &str) -> ClientInfo {
    let path = resolve(app, target).unwrap_or_default();
    let text = read_text(&path).unwrap_or_default();
    let configured = match target.format {
        Format::Json { root } => json_is_configured(&path, root),
        Format::Toml => toml_has_block(&text),
    };
    ClientInfo {
        id: target.id,
        name: target.name,
        detected: is_detected(target, &path),
        configured,
        path: path.to_string_lossy().to_string(),
        exists: path.exists(),
        note: target.note,
        homepage: target.homepage,
        stdio_bridge: target.stdio_bridge,
        preview: preview(target, url, token),
    }
}

/// 写入（已存在则就地更新，可重复点）
pub fn apply(
    app: &AppHandle,
    target: &Target,
    url: &str,
    token: &str,
) -> Result<ApplyResult, String> {
    let path = resolve(app, target)?;

    match target.format {
        Format::Toml => {
            let existing = read_text(&path)?;
            // 用户可能手写过同名表；那种情况我们不去猜它的行范围，直接拒绝并说明
            if !toml_has_block(&existing)
                && existing.contains(&format!("[mcp_servers.{SERVER_NAME}]"))
            {
                return Err(format!(
                    "{} 里已经有一个手写的 [mcp_servers.{SERVER_NAME}] 段，本应用不去动它。请自行删除那一段后重试。",
                    path.display()
                ));
            }
            backup(&path);
            let mut body = strip_toml_block(&existing);
            while body.ends_with("\n\n") {
                body.pop();
            }
            if !body.trim().is_empty() && !body.ends_with('\n') {
                body.push('\n');
            }
            let text = format!("{}\n{}\n", body, toml_block(url, token));
            write_text(&path, &text)?;
        }
        Format::Json { root } => {
            let mut value = parse_json(&path)?;
            let map = value
                .as_object_mut()
                .ok_or_else(|| format!("{} 的顶层不是 JSON 对象，已跳过", path.display()))?;
            let servers = map
                .entry(root.to_string())
                .or_insert_with(|| Value::Object(Map::new()));
            if !servers.is_object() {
                *servers = Value::Object(Map::new());
            }
            servers
                .as_object_mut()
                .expect("刚刚确保过是对象")
                .insert(SERVER_NAME.to_string(), entry_of(target, url, token));

            backup(&path);
            let text =
                serde_json::to_string_pretty(&value).map_err(|e| format!("序列化配置失败：{e}"))?;
            write_text(&path, &format!("{text}\n"))?;
        }
    }

    Ok(ApplyResult {
        path: path.to_string_lossy().to_string(),
        message: if target.stdio_bridge {
            format!(
                "已写入 {path}（需要本机有 Node.js）；重启 {} 后生效",
                target.name,
                path = path.display()
            )
        } else {
            format!(
                "已写入 {}；重启 {} 或新开会话后生效",
                path.display(),
                target.name
            )
        },
    })
}

/// 移除本应用写入的条目（用户自己加的别的 MCP 服务不受影响）
pub fn remove(app: &AppHandle, target: &Target) -> Result<ApplyResult, String> {
    let path = resolve(app, target)?;

    match target.format {
        Format::Toml => {
            let existing = read_text(&path)?;
            if !toml_has_block(&existing) {
                return Err(format!("{} 里没有找到由本应用写入的配置段", path.display()));
            }
            backup(&path);
            let text = strip_toml_block(&existing);
            write_text(&path, &text)?;
        }
        Format::Json { root } => {
            let mut value = parse_json(&path)?;
            let removed = value
                .get_mut(root)
                .and_then(|servers| servers.as_object_mut())
                .map(|servers| servers.remove(SERVER_NAME).is_some())
                .unwrap_or(false);
            if !removed {
                return Err(format!("{} 里没有找到本应用的条目", path.display()));
            }
            backup(&path);
            let text =
                serde_json::to_string_pretty(&value).map_err(|e| format!("序列化配置失败：{e}"))?;
            write_text(&path, &format!("{text}\n"))?;
        }
    }

    Ok(ApplyResult {
        path: path.to_string_lossy().to_string(),
        message: format!("已从 {} 移除本应用的条目", path.display()),
    })
}

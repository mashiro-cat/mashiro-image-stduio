//! Mashiro Studio · AI 生图工作台 —— Rust 侧（Tauri 后端）
//!
//! Rust 侧只做两件前端做不到的事：
//! 1. **代理所有出网请求**（绕开 WebView 的 CORS 限制，同时避免密钥暴露在页面网络面板外）；
//! 2. **本地文件读写**（生成结果、历史记录、配置持久化）。
//!
//! # 目录结构（按「能力」纵切，而非按「层」横切）
//!
//! ```text
//! src/
//! ├── main.rs              二进制入口，只调用本 crate 的 run()
//! ├── lib.rs               组装层：声明模块 + 注册命令 + 启动 Tauri（不放实现）
//! ├── http/                出网代理域
//! │   ├── types.rs         IPC 契约（请求 / 响应 DTO）
//! │   ├── client.rs        reqwest 客户端、超时策略、响应归一化、错误翻译
//! │   └── commands.rs      http_request / http_multipart
//! ├── fs/                  本地文件域
//! │   ├── paths.rs         数据目录定位 + 路径白名单（安全边界）
//! │   └── commands.rs      读写 / 删除 / 导出类命令
//! └── system/              系统集成域
//!     └── reveal.rs        调起资源管理器 / 访达定位文件
//! ```
//!
//! `mcp/` 是后加的第五个域（MCP 服务：把生图能力暴露给外部 Agent 客户端），
//! 内部同样是 mod.rs + 单职责文件；它的分工是「协议与传输在 Rust，生图能力仍在前端」，
//! 详见 `mcp/mod.rs` 的说明。
//!
//! `upscale/` 是第六个域（本地 AI 超分）：唯一一个**不依赖任何用户配置、
//! 也完全不联网**的能力——模型按需下载到数据目录后，推理在本地 CPU 上完成。
//! 分工是「Rust 内嵌 ONNX 推理，前端只发一张图、收一张图」。
//!
//! # 约定
//!
//! - 新增能力先判断「属于哪个域」，再在该域下加文件；**不要往 `lib.rs` 里塞实现**。
//!   域的划分标准是「宿主能力」而非「技术上像什么」：需要调起进程、读写磁盘、
//!   访问系统目录的，才配拥有自己的域。
//! - 每个域内部保持 `mod.rs`（职责说明 + 子模块声明）+ 单一职责文件，
//!   拆到 300 行左右就该考虑再分文件。
//! - **命令名与参数名是前端公开契约**：`src/platform/http.ts`、`src/platform/storage.ts`
//!   按名字 invoke，改名必须同步改前端（`#[serde(rename_all = "camelCase")]` 决定参数名）。
//! - Rust 侧错误统一 `Result<T, String>`：Tauri 会把 `Err` 里的字符串原样交给前端 catch，
//!   所以错误文案要面向用户、可直接展示。
//! - 所有文件访问必须先过 `fs::paths::guard_path`，不要相信前端传来的路径。

mod fs;
mod http;
mod mcp;
mod system;
mod thumb;
mod upscale;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            // ---- 出网代理 ----
            http::commands::http_request,
            http::commands::http_multipart,
            // ---- 数据目录与文件读写 ----
            fs::commands::app_data_root,
            fs::commands::ensure_dir,
            fs::commands::write_binary,
            fs::commands::read_binary,
            fs::commands::write_text,
            fs::commands::read_text,
            fs::commands::path_exists,
            fs::commands::remove_path,
            fs::commands::list_dir,
            fs::commands::export_copy,
            // ---- 缩略图（列表加载大图卡顿的解法，见 thumb/mod.rs） ----
            thumb::commands::image_thumbnail,
            // ---- 系统集成 ----
            system::reveal::reveal_in_folder,
            // ---- MCP 服务（启停 / 状态 / 回执 / 客户端配置） ----
            mcp::commands::mcp_status,
            mcp::commands::mcp_start,
            mcp::commands::mcp_stop,
            mcp::commands::mcp_configure,
            mcp::commands::mcp_bridge_ready,
            mcp::commands::mcp_respond,
            mcp::commands::mcp_tools,
            mcp::commands::mcp_clients,
            mcp::commands::mcp_apply_client,
            mcp::commands::mcp_remove_client,
            mcp::commands::mcp_reveal_client_config,
            // ---- 本地超分（ONNX 推理，纯本机不联网） ----
            upscale::commands::upscale_status,
            upscale::commands::upscale_probe_gpu,
            upscale::commands::upscale_list_models,
            upscale::commands::upscale_download_model,
            upscale::commands::upscale_remove_model,
            upscale::commands::upscale_image,
            upscale::commands::upscale_batch
        ])
        .setup(|app| {
            // MCP 状态要在最前面就位：这个能力由外部客户端触发，
            // 不能等用户打开设置页才存在
            let handle = app.handle().clone();
            app.manage(mcp::McpState::new(mcp::load_config(&handle)));
            mcp::commands::autostart(&handle);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

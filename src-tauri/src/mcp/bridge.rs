//! 工具调用桥：把 MCP 请求交给渲染层，并等它把结果送回来。
//!
//! 服务线程是普通的 `std::thread`，所以这里直接用 `mpsc::recv_timeout` 阻塞等待，
//! 不需要为一次转发引入异步运行时。
//!
//! 回执由前端通过 `mcp_respond` 命令送回（见 [`super::commands::mcp_respond`]），
//! 键是每次调用现生成的 `id`；超时或窗口未就绪都会给模型一句能看懂的原因，
//! 而不是让它一直挂着。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

/// 事件名：渲染层监听它来接收工具调用
pub const REQUEST_EVENT: &str = "mcp:request";

/// 渲染层回执
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeReply {
    /// 是否成功
    #[serde(default)]
    pub ok: bool,
    /// 给模型看的文本结论
    #[serde(default)]
    pub text: String,
    /// 结构化附带数据（图片路径、参数回执等），作为第二段文本返回
    #[serde(default)]
    pub data: Option<Value>,
}

pub struct BridgeHub {
    pending: Mutex<HashMap<String, Sender<BridgeReply>>>,
    /// 渲染层是否已经挂上监听（应用刚启动、或页面正在重载时还不算就绪）
    ready: AtomicBool,
    seq: AtomicU64,
}

impl BridgeHub {
    pub fn new() -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
            ready: AtomicBool::new(false),
            seq: AtomicU64::new(0),
        }
    }

    pub fn set_ready(&self, ready: bool) {
        self.ready.store(ready, Ordering::SeqCst);
        if !ready {
            // 页面卸载时把还挂着的等待清掉，避免它们白等到超时
            self.pending.lock().expect("mcp pending lock").clear();
        }
    }

    pub fn is_ready(&self) -> bool {
        self.ready.load(Ordering::SeqCst)
    }

    /// 转发一次调用并等待回执。
    pub fn call(
        &self,
        app: &AppHandle,
        tool: &str,
        args: Value,
        timeout: Duration,
    ) -> Result<BridgeReply, String> {
        if !self.is_ready() {
            return Err(
                "Mashiro Studio 窗口尚未就绪，无法执行生图。请确认应用正在运行，且窗口没有被关闭。"
                    .to_string(),
            );
        }

        let id = format!("call-{}", self.seq.fetch_add(1, Ordering::SeqCst) + 1);
        let (tx, rx) = channel::<BridgeReply>();
        self.pending
            .lock()
            .expect("mcp pending lock")
            .insert(id.clone(), tx);

        let payload = json!({ "id": id, "tool": tool, "args": args });
        if let Err(err) = app.emit(REQUEST_EVENT, payload) {
            self.pending.lock().expect("mcp pending lock").remove(&id);
            return Err(format!("无法把调用交给渲染层：{err}"));
        }

        let received = rx.recv_timeout(timeout);
        self.pending.lock().expect("mcp pending lock").remove(&id);

        match received {
            Ok(reply) => Ok(reply),
            Err(_) => Err(format!(
                "工具 {tool} 执行超时（已等待 {} 秒）。生图上游可能仍在继续，可让用户到 Mashiro Studio 的历史记录里确认结果，或把客户端里的工具超时时间调大。",
                timeout.as_secs()
            )),
        }
    }

    /// 渲染层交回结果。返回 `false` 表示这次调用已经超时或不存在（前端可忽略）。
    pub fn respond(&self, id: &str, reply: BridgeReply) -> bool {
        let sender = self.pending.lock().expect("mcp pending lock").remove(id);
        match sender {
            Some(tx) => tx.send(reply).is_ok(),
            None => false,
        }
    }
}

/* ==========================================================================
   MCP 服务 IPC 契约
   桌面端 → Rust 侧的 mcp_* 命令；浏览器预览没有宿主进程监听端口，因此不可用。

   命令名与参数名和 `src-tauri/src/mcp/commands.rs` 一一对应，改名要两边一起改。
   ========================================================================== */

import type { McpApplyResult, McpClientInfo, McpStatus, McpToolBrief } from "../types";
import { invoke, isTauri } from "./env";

/** MCP 服务只在桌面端可用：它需要宿主进程在回环地址上监听 */
export function mcpSupported(): boolean {
  return isTauri();
}

export function mcpStatus(): Promise<McpStatus> {
  return invoke<McpStatus>("mcp_status");
}

export function mcpStart(port?: number): Promise<McpStatus> {
  return invoke<McpStatus>("mcp_start", { port: port ?? null });
}

export function mcpStop(): Promise<McpStatus> {
  return invoke<McpStatus>("mcp_stop");
}

/** 改端口 / 轮换令牌；服务开着时按新参数重启 */
export function mcpConfigure(port: number, rotateToken = false): Promise<McpStatus> {
  return invoke<McpStatus>("mcp_configure", { port, rotateToken });
}

/** 告诉 Rust 侧渲染层是否已挂上监听（未就绪时工具调用会明确报错，而不是干等） */
export function mcpReportBridge(ready: boolean): Promise<void> {
  return invoke<void>("mcp_bridge_ready", { ready });
}

/** 交回一次工具调用的执行结果 */
export function mcpRespond(payload: {
  id: string;
  ok: boolean;
  text: string;
  data?: unknown;
}): Promise<boolean> {
  return invoke<boolean>("mcp_respond", payload);
}

export function mcpClients(): Promise<McpClientInfo[]> {
  return invoke<McpClientInfo[]>("mcp_clients");
}

/** 本服务对外暴露的工具清单（界面展示用，来源就是服务端 schema） */
export function mcpTools(): Promise<McpToolBrief[]> {
  return invoke<McpToolBrief[]>("mcp_tools");
}

export function mcpApplyClient(clientId: string): Promise<McpApplyResult> {
  return invoke<McpApplyResult>("mcp_apply_client", { clientId });
}

export function mcpRemoveClient(clientId: string): Promise<McpApplyResult> {
  return invoke<McpApplyResult>("mcp_remove_client", { clientId });
}

export function mcpRevealClientConfig(clientId: string): Promise<void> {
  return invoke<void>("mcp_reveal_client_config", { clientId });
}

/* ------------------------------------------------------------ 工具调用事件 */

/** Rust 侧把工具调用推给渲染层用的事件名 */
export const MCP_REQUEST_EVENT = "mcp:request";

export interface McpRequest {
  id: string;
  tool: string;
  args: Record<string, unknown>;
}

/**
 * 订阅工具调用。
 * 返回解除订阅的函数——**必须在页面卸载时调用**，
 * 否则 Rust 侧会以为渲染层还在等结果，直到超时。
 */
export async function listenMcpRequests(
  handler: (request: McpRequest) => void,
): Promise<() => void> {
  const mod = await import("@tauri-apps/api/event");
  return mod.listen<McpRequest>(MCP_REQUEST_EVENT, (event) => handler(event.payload));
}

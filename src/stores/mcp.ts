import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type { McpCallRecord, McpClientInfo, McpStatus, McpToolBrief } from "../types";
import * as api from "../platform/mcp";
import { copyText } from "../platform/env";
import { startMcpBridge } from "../services/mcpBridge";
import { useUiStore } from "./ui";

/**
 * MCP 服务状态。
 *
 * 服务的生命周期由 Rust 侧持有（配置也在那边落盘），这里只做三件事：
 * 读取状态、把动作转成命令、保留一份最近调用的记录给界面看。
 * 调用记录刻意只在内存里——它是「刚才发生了什么」的观察窗，不是需要长期保存的数据。
 */
export const useMcpStore = defineStore("mcp", () => {
  const ui = useUiStore();

  const status = ref<McpStatus | null>(null);
  const clients = ref<McpClientInfo[]>([]);
  const tools = ref<McpToolBrief[]>([]);
  const calls = ref<McpCallRecord[]>([]);
  const error = ref("");
  const busy = ref("");
  const loaded = ref(false);

  /** MCP 需要宿主进程监听端口，浏览器预览用不了 */
  const supported = api.mcpSupported();
  const running = computed(() => status.value?.running ?? false);
  /** 渲染层是否已挂上监听：没挂上时工具调用会在等超时后失败，界面上要能看出来 */
  const bridgeReady = computed(() => status.value?.bridgeReady ?? false);
  const endpoint = computed(() => status.value?.url ?? "");
  const configuredCount = computed(() => clients.value.filter((client) => client.configured).length);

  const MAX_CALLS = 40;

  function describe(err: unknown): string {
    return ui.describe(err) || "操作失败";
  }

  function apply(next: McpStatus) {
    status.value = next;
    error.value = "";
  }

  async function refresh() {
    if (!supported) return;
    try {
      apply(await api.mcpStatus());
    } catch (err) {
      error.value = describe(err);
    }
  }

  async function loadClients() {
    if (!supported) return;
    try {
      if (!tools.value.length) tools.value = await api.mcpTools();
      clients.value = await api.mcpClients();
    } catch (err) {
      error.value = describe(err);
    }
    loaded.value = true;
  }

  async function start(port?: number) {
    busy.value = "power";
    try {
      apply(await api.mcpStart(port));
      await loadClients();
      ui.success("MCP 服务已开启", `正在监听 ${status.value?.url ?? ""}`);
    } catch (err) {
      error.value = describe(err);
      ui.error("MCP 服务开启失败", error.value);
      // 端口被占用这类失败会让服务保持停止，把真实状态同步回来
      await refresh();
    } finally {
      busy.value = "";
    }
  }

  async function stop() {
    busy.value = "power";
    try {
      apply(await api.mcpStop());
      ui.info("MCP 服务已关闭");
    } catch (err) {
      error.value = describe(err);
      ui.error("关闭失败", error.value);
    } finally {
      busy.value = "";
    }
  }

  async function configure(port: number, rotateToken = false) {
    busy.value = "config";
    try {
      apply(await api.mcpConfigure(port, rotateToken));
      await loadClients();
      ui.success(
        rotateToken ? "已轮换访问令牌" : "已更新端口",
        rotateToken ? "所有已写入的客户端配置需要重新写入一次" : `当前监听 ${status.value?.url ?? ""}`,
      );
    } catch (err) {
      error.value = describe(err);
      ui.error("更新失败", error.value);
      await refresh();
    } finally {
      busy.value = "";
    }
  }

  async function applyClient(clientId: string) {
    busy.value = clientId;
    try {
      const result = await api.mcpApplyClient(clientId);
      await loadClients();
      ui.success("已写入客户端配置", result.message);
      return true;
    } catch (err) {
      error.value = describe(err);
      // 客户端配置文件可能不是合法 JSON，这类原因必须完整展示（含修复建议）
      ui.error("写入失败", error.value.slice(0, 300));
      return false;
    } finally {
      busy.value = "";
    }
  }

  /** 批量写入所有「检测到但还没配置」的客户端：装了好几个客户端时不用一个个点 */
  async function applyDetected() {
    const targets = clients.value.filter((client) => client.detected && !client.configured);
    if (!targets.length) {
      ui.info("没有需要写入的客户端", "已检测到的客户端都配置好了");
      return;
    }
    busy.value = "batch";
    const failed: string[] = [];
    let done = 0;
    // 串行写入：每个客户端的文件不同，但并发写同一个目录下的文件没有好处，
    // 出错时也更容易定位是哪一个
    for (const client of targets) {
      try {
        await api.mcpApplyClient(client.id);
        done += 1;
      } catch {
        failed.push(client.name);
      }
    }
    await loadClients();
    busy.value = "";
    if (done) {
      ui.success(
        `已写入 ${done} 个客户端`,
        failed.length ? `失败：${failed.join("、")}（详见下方提示）` : "重启对应客户端后生效",
      );
    } else {
      ui.error("写入失败", failed.join("、"));
    }
  }

  async function removeClient(clientId: string) {    busy.value = clientId;
    try {
      const result = await api.mcpRemoveClient(clientId);
      await loadClients();
      ui.info("已移除配置", result.message);
    } catch (err) {
      error.value = describe(err);
      ui.error("移除失败", error.value);
    } finally {
      busy.value = "";
    }
  }

  async function revealClient(clientId: string) {
    try {
      await api.mcpRevealClientConfig(clientId);
    } catch (err) {
      ui.error("打不开配置文件", describe(err));
    }
  }

  async function copy(text: string, label = "已复制") {
    const ok = await copyText(text);
    if (ok) ui.success(label);
    else ui.warning("复制失败", "请手动选中文本复制");
  }

  function recordCall(record: McpCallRecord) {
    calls.value = [record, ...calls.value].slice(0, MAX_CALLS);
  }

  function clearCalls() {
    calls.value = [];
  }

  /**
   * 挂上工具调用监听。
   * 必须在应用启动时调用一次：接口配置好了但桥没挂，工具调用只会等到超时。
   */
  let stopBridge: (() => void) | null = null;
  async function startBridge() {
    if (!supported || stopBridge) return;
    try {
      stopBridge = await startMcpBridge({ onCall: recordCall });
      await refresh();
    } catch (err) {
      error.value = describe(err);
    }
  }

  /** 摘掉监听并告诉 Rust 侧「没人处理了」，避免调用白等到超时 */
  function detachBridge() {
    stopBridge?.();
    stopBridge = null;
  }

  /** 设置页打开期间轻量轮询状态，让计数与「桥是否就绪」保持新鲜 */
  function watch(): () => void {
    void refresh();
    void loadClients();
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(timer);
  }

  return {
    supported,
    status,
    clients,
    tools,
    calls,
    error,
    busy,
    loaded,
    running,
    bridgeReady,
    endpoint,
    configuredCount,
    refresh,
    loadClients,
    start,
    stop,
    configure,
    applyClient,
    applyDetected,
    removeClient,
    revealClient,
    copy,
    recordCall,
    clearCalls,
    startBridge,
    detachBridge,
    watch,
  };
});

import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type { DebugLogEntry } from "../types";
import { configureDebug, debugRuntime, setDebugSink } from "../platform/debug";
import { readJson, writeJson } from "../platform/storage";
import { useSettingsStore } from "./settings";

/** 未开启调试时保留的精简日志条数 */
const BASIC_CAP = 40;
/** 落盘上限，避免日志文件无限增长 */
const PERSIST_CAP = 200;

export const useDebugLogStore = defineStore("debugLog", () => {
  const settings = useSettingsStore();

  const entries = ref<DebugLogEntry[]>([]);
  const loaded = ref(false);
  const keyword = ref("");
  const onlyErrors = ref(false);
  const expandedId = ref("");

  const enabled = computed(() => settings.state.debug.enabled);
  const errorCount = computed(() => entries.value.filter((entry) => !entry.ok).length);
  const lastError = computed(() => entries.value.find((entry) => !entry.ok));

  const filtered = computed(() => {
    const text = keyword.value.trim().toLowerCase();
    return entries.value.filter((entry) => {
      if (onlyErrors.value && entry.ok) return false;
      if (!text) return true;
      return (
        entry.url.toLowerCase().includes(text) ||
        entry.source.toLowerCase().includes(text) ||
        String(entry.status).includes(text) ||
        (entry.error ?? "").toLowerCase().includes(text)
      );
    });
  });

  /**
   * 平台层真正生效的开关状态。
   * 与 settings.state.debug.enabled 不同，它读的是 http.ts 实际使用的那份运行时配置，
   * 因此可以用来判断「设置已开但请求层没收到」，避免出现静默失效。
   */
  const platformEnabled = ref(false);

  function refreshRuntimeState() {
    platformEnabled.value = debugRuntime().enabled;
  }

  /** 把设置同步到平台层，http.ts 会在每次请求时读取 */
  function syncRuntime() {
    const debug = settings.state.debug;
    configureDebug({
      enabled: debug.enabled,
      captureBody: debug.captureBody,
      captureHeaders: debug.captureHeaders,
      maxEntries: debug.maxEntries,
    });
    refreshRuntimeState();
  }

  /** 开关打开但平台层没生效时的提示文案 */
  const runtimeMismatch = computed(() => enabled.value && !platformEnabled.value);

  let saveTimer: number | undefined;
  function persist() {
    // 无论调试开关是否开启都落盘：
    // 用户往往是「先遇到失败、再回头开调试」，保留基础记录才能事后回溯。
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      void writeJson("debug-log", entries.value.slice(0, PERSIST_CAP));
    }, 500);
  }

  function push(entry: DebugLogEntry) {
    entries.value.unshift(entry);
    const cap = settings.state.debug.enabled ? Math.max(20, settings.state.debug.maxEntries) : BASIC_CAP;
    if (entries.value.length > cap) entries.value = entries.value.slice(0, cap);
    persist();
  }

  async function load() {
    setDebugSink({ push });
    syncRuntime();
    const saved = await readJson<DebugLogEntry[]>("debug-log", []);
    if (Array.isArray(saved) && saved.length) entries.value = saved;
    // 重启后丢弃「进行中」的悬挂状态，重新开始计数
    loaded.value = true;
  }

  function clear() {
    entries.value = [];
    expandedId.value = "";
    void writeJson("debug-log", []);
  }

  function toggleExpanded(id: string) {
    expandedId.value = expandedId.value === id ? "" : id;
  }

  /** 导出为可直接发给他人 / 提 issue 的 JSON */
  function exportJson(): string {
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        app: "Mashiro Studio 0.1.0",
        debugEnabled: settings.state.debug.enabled,
        bases: {
          modelApi: settings.state.modelApi.channels.map((channel) => channel.baseUrl),
          workflowApi: settings.state.workflowApi.channels.map((channel) => channel.baseUrl),
          llm: settings.state.llm.baseUrl,
        },
        total: entries.value.length,
        entries: entries.value,
      },
      null,
      2,
    );
  }

  return {
    entries,
    loaded,
    keyword,
    onlyErrors,
    expandedId,
    enabled,
    platformEnabled,
    runtimeMismatch,
    errorCount,
    lastError,
    filtered,
    load,
    push,
    clear,
    persist,
    toggleExpanded,
    exportJson,
    syncRuntime,
    refreshRuntimeState,
  };
});

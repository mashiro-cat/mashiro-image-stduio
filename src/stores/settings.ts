import { computed, reactive, ref, watch } from "vue";
import { defineStore } from "pinia";
import type {
  AppSettings,
  ChannelGroup,
  DebugConfig,
  ImageQuality,
  ImageResponseFormat,
  LlmConfig,
  ModelApiConfig,
  SettingsState,
  WorkflowApiConfig,
  WorkflowInput,
  WorkflowNodeRole,
  WorkflowPreset,
} from "../types";
import { readJson, writeJson } from "../platform/storage";
import { uid } from "../platform/env";
import { setLocalePreference, t } from "../i18n";
import { AUTO_SIZE, NODE_ROLE_META, NODE_ROLE_ORDER } from "../types";

/* ------------------------------------------------------------ 渠道默认值与工厂 */

/** 单条生图渠道的字段默认值（不含渠道自身的 id / 名称） */
export const MODEL_CHANNEL_DEFAULTS: Omit<ModelApiConfig, "id" | "name"> = {
  enabled: true,
  baseUrl: "https://xxxx.xxx",
  apiKey: "",
  model: "gpt-image-2",
  modelOptions: ["gpt-image-2.5", "gpt-image-2"],
  quality: "high",
  // 默认走 base64：接口直接把图片数据返回给客户端，
  // 不依赖上游可能随时过期的临时外链，也少一次下载请求。
  responseFormat: "b64_json",
  timeoutSec: 300,
};

export const RESPONSE_FORMAT_OPTIONS: Array<{ label: string; value: ImageResponseFormat; hint: string }> = [
  { label: "base64", value: "b64_json", hint: "接口直接返回图片数据，客户端解码后落盘，推荐" },
  { label: "图片链接", value: "url", hint: "接口返回临时下载链接，客户端再拉取一次" },
];

/** 单条工作流渠道的字段默认值（不含渠道自身的 id / 名称） */
export const WORKFLOW_CHANNEL_DEFAULTS: Omit<WorkflowApiConfig, "id" | "name"> = {
  enabled: true,
  baseUrl: "https://www.runninghub.cn",
  apiKey: "",
  pollIntervalSec: 4,
  pollTimeoutSec: 600,
  addMetadata: true,
  retainSeconds: 0,
  presets: [],
};

export const DEFAULT_LLM: LlmConfig = {
  enabled: true,
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  temperature: 0.8,
  maxTokens: 1500,
  timeoutSec: 120,
  // 默认关闭思考模式：增强要的是最终 JSON，思考过程只会占用 token 并把正文挤到 reasoning_content
  disableThinking: true,
  jsonMode: true,
  sendImages: true,
  systemPrompt: "",
};

export const DEFAULT_APP: AppSettings = {
  theme: "light",
  // 默认跟随系统：绝大多数用户装完就希望看到母语界面，
  // 显式设成中文反而会让英文系统的用户第一眼看到一堆方框
  locale: "system",
  demoMode: false,
  // 默认交给模型自己定画幅：大多数提示词本身就含画幅线索（竖构图海报 / 宽幅场景），
  // 硬塞一个方图反而会限制它
  defaultSize: AUTO_SIZE,
  defaultCount: 2,
  defaultStyle: "",
  autoSaveHistory: true,
  persistImages: true,
};

export const DEFAULT_DEBUG: DebugConfig = {
  enabled: false,
  captureBody: true,
  captureHeaders: true,
  maxEntries: 120,
};

/* ------------------------------------------------------------ 工作流输入槽位 */

/** 旧版配置里的五个标量槽位（用于迁移到 inputs 列表） */
const LEGACY_INPUT_KEYS: Array<{ role: WorkflowNodeRole; key: string }> = [
  { role: "positive", key: "positivePromptNode" },
  { role: "negative", key: "negativePromptNode" },
  { role: "image", key: "imageNode" },
  { role: "seed", key: "seedNode" },
  { role: "steps", key: "stepsNode" },
];

/** 同角色多个时补上序号：「输入图片」「输入图片 2」… */
export function relabelInputs(inputs: WorkflowInput[]): WorkflowInput[] {
  const counter = new Map<WorkflowNodeRole, number>();
  return inputs.map((input) => {
    const index = (counter.get(input.role) ?? 0) + 1;
    counter.set(input.role, index);
    const base = NODE_ROLE_META[input.role].label;
    return { ...input, label: index === 1 ? base : `${base} ${index}` };
  });
}

/**
 * 读取节点映射：兼容旧的「五个标量字段 + fieldNames」结构，
 * 以及新的 `inputs` 列表。旧配置会在加载时一次性迁移过来。
 */
export function readNodeInputs(raw: unknown): WorkflowInput[] {
  if (!raw || typeof raw !== "object") return [];
  const map = raw as Record<string, unknown> & { inputs?: unknown; fieldNames?: Record<string, string> };
  const list: WorkflowInput[] = [];

  if (Array.isArray(map.inputs)) {
    for (const item of map.inputs) {
      const input = item as Partial<WorkflowInput>;
      const role = input.role as WorkflowNodeRole;
      if (!role || !NODE_ROLE_META[role]) continue;
      const nodeId = String(input.nodeId ?? "").trim();
      const fieldName = String(input.fieldName ?? "").trim() || NODE_ROLE_META[role].defaultField;
      if (!nodeId) continue;
      list.push({ id: String(input.id ?? "") || uid("in"), role, nodeId, fieldName, label: "" });
    }
    return relabelInputs(list);
  }

  for (const legacy of LEGACY_INPUT_KEYS) {
    const nodeId = String(map[legacy.key] ?? "").trim();
    if (!nodeId) continue;
    const fieldName = String(map.fieldNames?.[legacy.role] ?? "").trim() || NODE_ROLE_META[legacy.role].defaultField;
    list.push({ id: uid("in"), role: legacy.role, nodeId, fieldName, label: "" });
  }
  return relabelInputs(list);
}

/** 新增一个空槽位（手动添加时用；nodeId 可后续再填） */
export function createWorkflowInput(role: WorkflowNodeRole, patch: Partial<WorkflowInput> = {}): WorkflowInput {
  return {
    id: uid("in"),
    role,
    nodeId: "",
    fieldName: NODE_ROLE_META[role].defaultField,
    label: NODE_ROLE_META[role].label,
    ...patch,
  };
}

/** 槽位排序：按角色固定顺序，同角色保持原有先后 */
export function sortInputs(inputs: WorkflowInput[]): WorkflowInput[] {
  return [...inputs].sort(
    (a, b) => NODE_ROLE_ORDER.indexOf(a.role) - NODE_ROLE_ORDER.indexOf(b.role),
  );
}

export const createWorkflowPreset = (patch: Partial<WorkflowPreset> = {}): WorkflowPreset => ({
  id: uid("wf"),
  name: "新建工作流",
  workflowId: "",
  accessPassword: "",
  instanceType: "default",
  note: "",
  ...patch,
  // 节点映射统一经过读取器，旧结构（五个标量 + fieldNames）在这里被就地迁移
  nodes: { inputs: readNodeInputs(patch.nodes) },
});

export const createModelChannel = (patch: Partial<ModelApiConfig> = {}): ModelApiConfig => ({
  id: uid("mdl"),
  name: "生图渠道",
  ...MODEL_CHANNEL_DEFAULTS,
  modelOptions: [...MODEL_CHANNEL_DEFAULTS.modelOptions],
  ...patch,
});

export const createWorkflowChannel = (patch: Partial<WorkflowApiConfig> = {}): WorkflowApiConfig => ({
  id: uid("wfch"),
  name: "工作流渠道",
  ...WORKFLOW_CHANNEL_DEFAULTS,
  ...patch,
  presets: (patch.presets ?? []).map((preset) => createWorkflowPreset(preset)),
});

/* ------------------------------------------------------------ 尺寸 / 画质选项 */

export interface AspectOption {
  label: string;
  ratio: string;
  size: string;
  hint: string;
}

/**
 * 画幅选项。
 *
 * ⚠️ `label` / `hint` 是**稳定的中文技术描述**，不是界面文案：
 * `services/mcpBridge.ts` 会把它们原样暴露给外部 Agent（MCP 工具的枚举说明），
 * 那里的措辞必须与接口文档一致、不能随界面语言漂移。
 *
 * 界面展示走 `aspectOptions()`，它按 `labelKey` / `hintKey` 查当前语言的词条。
 */
export const ASPECT_OPTIONS: Array<AspectOption & { labelKey: string; hintKey: string }> = [
  { label: "自动", ratio: "auto", size: AUTO_SIZE, hint: "由模型按提示词自行决定画幅，不限制尺寸", labelKey: "settings.general.aspect.auto.label", hintKey: "settings.general.aspect.auto.hint" },
  { label: "1:1", ratio: "1:1", size: "1024x1024", hint: "方形 · 1024×1024", labelKey: "settings.general.aspect.sq1k.label", hintKey: "settings.general.aspect.sq1k.hint" },
  { label: "3:2", ratio: "3:2", size: "1536x1024", hint: "横版 · 1536×1024", labelKey: "settings.general.aspect.land3x2.label", hintKey: "settings.general.aspect.land3x2.hint" },
  { label: "2:3", ratio: "2:3", size: "1024x1536", hint: "竖版 · 1024×1536", labelKey: "settings.general.aspect.port2x3.label", hintKey: "settings.general.aspect.port2x3.hint" },
  { label: "2K 方", ratio: "1:1", size: "2048x2048", hint: "2K 方形 · 2048×2048", labelKey: "settings.general.aspect.sq2k.label", hintKey: "settings.general.aspect.sq2k.hint" },
  { label: "16:9", ratio: "16:9", size: "2048x1152", hint: "宽屏 · 2048×1152", labelKey: "settings.general.aspect.wide16x9.label", hintKey: "settings.general.aspect.wide16x9.hint" },
  { label: "4K 横", ratio: "16:9", size: "3840x2160", hint: "4K 横版 · 3840×2160", labelKey: "settings.general.aspect.uhd16x9.label", hintKey: "settings.general.aspect.uhd16x9.hint" },
  { label: "9:16", ratio: "9:16", size: "2160x3840", hint: "4K 竖版 · 2160×3840", labelKey: "settings.general.aspect.uhd9x16.label", hintKey: "settings.general.aspect.uhd9x16.hint" },
];

/** 画幅选项的本地化视图（渲染期调用，切语言后自然重算） */
export function aspectOptions(): AspectOption[] {
  return ASPECT_OPTIONS.map((item) => ({ ...item, label: t(item.labelKey), hint: t(item.hintKey) }));
}

/** 旧版内置默认尺寸；「自动」成为新默认后拿它做一次性平滑迁移 */
const LEGACY_DEFAULT_SIZE = "1024x1024";

/**
 * 尺寸迁移：没填过、或还是旧版内置默认值的，统一升到新默认（自动）。
 * 用值本身判定，所以是幂等的，不会反复改写用户后来选定的尺寸。
 */
export function migrateDefaultSize(size?: string): string {
  return !size || size === LEGACY_DEFAULT_SIZE ? DEFAULT_APP.defaultSize : size;
}

/**
 * 画质选项。同 `ASPECT_OPTIONS`：`label` / `hint` 是给 MCP 用的稳定中文描述，
 * 界面走 `qualityOptions()` 查词条。
 */
export const QUALITY_OPTIONS: Array<{
  label: string;
  value: ImageQuality;
  hint: string;
  labelKey: string;
  hintKey: string;
}> = [
  { label: "自动", value: "auto", hint: "由服务端决定", labelKey: "settings.model.quality.auto.label", hintKey: "settings.model.quality.auto.hint" },
  { label: "高", value: "high", hint: "细节最佳，耗时更长", labelKey: "settings.model.quality.high.label", hintKey: "settings.model.quality.high.hint" },
  { label: "中", value: "medium", hint: "平衡画质与速度", labelKey: "settings.model.quality.medium.label", hintKey: "settings.model.quality.medium.hint" },
  { label: "低", value: "low", hint: "快速出草图", labelKey: "settings.model.quality.low.label", hintKey: "settings.model.quality.low.hint" },
];

/** 画质选项的本地化视图（渲染期调用） */
export function qualityOptions(): Array<{ label: string; value: ImageQuality; hint: string }> {
  return QUALITY_OPTIONS.map((item) => ({ value: item.value, label: t(item.labelKey), hint: t(item.hintKey) }));
}

/**
 * 返回格式选项。同样 `label`/`hint` 供 MCP 用，界面走 `responseFormatOptions()`。
 * 注意 `base64` 的 label 保持协议取值不译（那是 API 文档里的写法），
 * 另一种取值的 label 是给人看的（「图片链接」），跟着语言走。
 */
export function responseFormatOptions(): Array<{ label: string; value: ImageResponseFormat; hint: string }> {
  return [
    { label: "base64", value: "b64_json", hint: t("settings.model.responseFormat.b64_json.hint") },
    { label: t("settings.model.responseFormat.url.label"), value: "url", hint: t("settings.model.responseFormat.url.hint") },
  ];
}

/** 渠道是否可用于生图：必须启用且已填密钥 */
const usable = <T extends { enabled: boolean; apiKey: string }>(channel: T): boolean =>
  channel.enabled && Boolean(channel.apiKey);

/** 读取渠道集合，并把旧版「单份配置」自动迁移为一个渠道 */
function readChannels<C extends { id: string }>(
  saved: unknown,
  factory: (patch: Partial<C>) => C,
): ChannelGroup<C> {
  if (!saved || typeof saved !== "object") return { activeId: "", channels: [] };
  const raw = saved as Record<string, unknown>;

  if (Array.isArray(raw.channels)) {
    const channels = (raw.channels as Array<Partial<C>>).map((item) => factory(item ?? {}));
    const activeId = typeof raw.activeId === "string" ? raw.activeId : (channels[0]?.id ?? "");
    return { activeId, channels };
  }

  // 旧版本配置文件：modelApi / workflowApi 本身就是一份配置
  if ("apiKey" in raw || "baseUrl" in raw) {
    const channel = factory(raw as unknown as Partial<C>);
    return { activeId: channel.id, channels: [channel] };
  }
  return { activeId: "", channels: [] };
}

export const useSettingsStore = defineStore("settings", () => {
  const state = reactive<SettingsState>({
    modelApi: { activeId: "", channels: [createModelChannel({ name: "默认生图渠道" })] },
    workflowApi: { activeId: "", channels: [createWorkflowChannel({ name: "默认工作流渠道" })] },
    llm: { ...DEFAULT_LLM },
    app: { ...DEFAULT_APP },
    debug: { ...DEFAULT_DEBUG },
  });
  state.modelApi.activeId = state.modelApi.channels[0].id;
  state.workflowApi.activeId = state.workflowApi.channels[0].id;

  const loaded = ref(false);
  const activePresetId = ref<string>("");
  /** 配置写入失败时的原因（用于把「开关开了又还原」这类问题暴露出来） */
  const persistError = ref("");

  /* ------------------------------------------------------------ 派生状态 */

  /** 可用于生图的模型渠道（启用且已配置密钥） */
  const enabledModelChannels = computed(() => state.modelApi.channels.filter(usable));
  /** 可用于生图的工作流渠道 */
  const enabledWorkflowChannels = computed(() => state.workflowApi.channels.filter(usable));

  /**
   * 工作台当前实际使用的渠道：
   * 优先取 activeId 指向的渠道，若它已被停用 / 无密钥，则回退到第一个可用渠道。
   */
  const activeModelChannel = computed<ModelApiConfig | undefined>(() => {
    const list = state.modelApi.channels;
    const preferred = list.find((channel) => channel.id === state.modelApi.activeId);
    if (preferred && usable(preferred)) return preferred;
    return list.find(usable);
  });

  const activeWorkflowChannel = computed<WorkflowApiConfig | undefined>(() => {
    const list = state.workflowApi.channels;
    const preferred = list.find((channel) => channel.id === state.workflowApi.activeId);
    if (preferred && usable(preferred)) return preferred;
    return list.find(usable);
  });

  /** 当前工作流渠道下的预设；工作流生图只使用这些预设 */
  const workflowPresets = computed<WorkflowPreset[]>(() => activeWorkflowChannel.value?.presets ?? []);

  const hasModelApi = computed(() => enabledModelChannels.value.length > 0);
  const hasWorkflowApi = computed(() => enabledWorkflowChannels.value.length > 0);
  const hasLlm = computed(() => state.llm.enabled && Boolean(state.llm.apiKey));
  /** 未配置生图渠道（或手动开启演示模式）时走内置演示数据 */
  const useDemo = computed(() => state.app.demoMode || !hasModelApi.value);

  const activePreset = computed<WorkflowPreset | undefined>(() => {
    const list = workflowPresets.value;
    return list.find((preset) => preset.id === activePresetId.value) ?? list[0];
  });

  /* ------------------------------------------------------------ 持久化 */

  async function load() {
    const saved = await readJson<Partial<SettingsState>>("settings", {});
    const raw = saved as Record<string, unknown>;

    const model = readChannels<ModelApiConfig>(raw?.modelApi, createModelChannel);
    state.modelApi.channels = model.channels.length ? model.channels : [createModelChannel({ name: "默认生图渠道" })];
    state.modelApi.activeId = model.activeId || state.modelApi.channels[0].id;

    const workflow = readChannels<WorkflowApiConfig>(raw?.workflowApi, createWorkflowChannel);
    state.workflowApi.channels = workflow.channels.length
      ? workflow.channels
      : [createWorkflowChannel({ name: "默认工作流渠道" })];
    state.workflowApi.activeId = workflow.activeId || state.workflowApi.channels[0].id;

    if (saved.llm) Object.assign(state.llm, saved.llm);
    if (saved.app) Object.assign(state.app, saved.app);
    if (saved.debug) Object.assign(state.debug, saved.debug);
    // 老配置里的默认尺寸是旧版的 1:1，平滑升到「自动」（用户自己改过的不动）
    state.app.defaultSize = migrateDefaultSize(state.app.defaultSize);
    // 老配置没有 locale 字段，readLocalePreference 会回落到「跟随系统」
    state.app.locale = readLocalePreference(state.app.locale);
    loaded.value = true;

    const storedActive = await readJson<string>("activePreset", "");
    const list = workflowPresets.value;
    activePresetId.value = list.find((preset) => preset.id === storedActive)?.id ?? list[0]?.id ?? "";
  }

  let saveTimer: number | undefined;
  function persist() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(async () => {
      const result = await writeJson("settings", JSON.parse(JSON.stringify(state)));
      persistError.value = result.ok ? "" : (result.error ?? "配置保存失败");
    }, 260);
  }

  watch(state, persist, { deep: true });
  watch(activePresetId, (value) => void writeJson("activePreset", value));

  /* ------------------------------------------------------------ 渠道管理 */

  function addModelChannel() {
    const channel = createModelChannel({ name: `生图渠道 ${state.modelApi.channels.length + 1}` });
    state.modelApi.channels.push(channel);
    state.modelApi.activeId = channel.id;
    return channel;
  }

  function removeModelChannel(id: string) {
    state.modelApi.channels = state.modelApi.channels.filter((channel) => channel.id !== id);
    if (!state.modelApi.channels.length) {
      const channel = createModelChannel({ name: "默认生图渠道" });
      state.modelApi.channels.push(channel);
    }
    if (state.modelApi.activeId === id) {
      state.modelApi.activeId = enabledModelChannels.value[0]?.id ?? state.modelApi.channels[0].id;
    }
  }

  function addWorkflowChannel() {
    const channel = createWorkflowChannel({ name: `工作流渠道 ${state.workflowApi.channels.length + 1}` });
    state.workflowApi.channels.push(channel);
    state.workflowApi.activeId = channel.id;
    return channel;
  }

  function removeWorkflowChannel(id: string) {
    state.workflowApi.channels = state.workflowApi.channels.filter((channel) => channel.id !== id);
    if (!state.workflowApi.channels.length) {
      const channel = createWorkflowChannel({ name: "默认工作流渠道" });
      state.workflowApi.channels.push(channel);
    }
    if (state.workflowApi.activeId === id) {
      state.workflowApi.activeId = enabledWorkflowChannels.value[0]?.id ?? state.workflowApi.channels[0].id;
    }
  }

  /** 工作台切换渠道：只允许切到「启用且已填密钥」的渠道 */
  function selectModelChannel(id: string) {
    const target = state.modelApi.channels.find((channel) => channel.id === id);
    if (!target || !usable(target)) return false;
    state.modelApi.activeId = id;
    return true;
  }

  function selectWorkflowChannel(id: string) {
    const target = state.workflowApi.channels.find((channel) => channel.id === id);
    if (!target || !usable(target)) return false;
    state.workflowApi.activeId = id;
    activePresetId.value = target.presets[0]?.id ?? "";
    return true;
  }

  function addPreset(patch: Partial<WorkflowPreset> = {}) {
    const channel = activeWorkflowChannel.value;
    if (!channel) return undefined;
    const preset = createWorkflowPreset(patch);
    channel.presets.push(preset);
    activePresetId.value = preset.id;
    return preset;
  }

  function removePreset(id: string) {
    const channel = activeWorkflowChannel.value;
    if (!channel) return;
    channel.presets = channel.presets.filter((preset) => preset.id !== id);
    if (activePresetId.value === id) {
      activePresetId.value = channel.presets[0]?.id ?? "";
    }
  }

  function applyTheme() {
    document.documentElement.dataset.theme = state.app.theme;
  }

  /**
   * 应用界面语言。
   *
   * 与 `applyTheme` 一样是「把持久化偏好推到运行时」的入口，
   * 启动时和用户改设置时都走它。
   */
  function applyLocale() {
    setLocalePreference(state.app.locale);
  }

  /**
   * 读取磁盘配置里的语言偏好。
   *
   * ⚠️ **不能用 `Boolean(saved.locale)` 那种写法判断合法性**，
   * 也别直接把未知值丢给运行时：老配置里根本没有 `locale` 字段
   * （undefined），必须显式回落到 `"system"`，否则存量用户升级后
   * 会突然变成 `undefined` 语言、界面全空。
   */
  function readLocalePreference(raw: unknown): AppSettings["locale"] {
    if (raw === "system" || raw === "zh-CN" || raw === "en-US") return raw;
    return "system";
  }

  function toggleTheme() {
    state.app.theme = state.app.theme === "light" ? "dark" : "light";
    applyTheme();
  }

  async function resetAll() {
    state.modelApi.channels = [createModelChannel({ name: "默认生图渠道" })];
    state.modelApi.activeId = state.modelApi.channels[0].id;
    state.workflowApi.channels = [createWorkflowChannel({ name: "默认工作流渠道" })];
    state.workflowApi.activeId = state.workflowApi.channels[0].id;
    Object.assign(state.llm, DEFAULT_LLM);
    Object.assign(state.app, DEFAULT_APP);
    Object.assign(state.debug, DEFAULT_DEBUG);
    activePresetId.value = "";
    applyTheme();
    // 恢复出厂会把 locale 打回「跟随系统」，必须同步应用到运行时，
    // 否则磁盘上已经存了新值、界面却还停在旧语言
    applyLocale();
    await writeJson("settings", state);
  }

  return {
    state,
    loaded,
    persistError,
    activePresetId,
    activePreset,
    enabledModelChannels,
    enabledWorkflowChannels,
    activeModelChannel,
    activeWorkflowChannel,
    workflowPresets,
    hasModelApi,
    hasWorkflowApi,
    hasLlm,
    useDemo,
    load,
    applyTheme,
    applyLocale,
    toggleTheme,
    addModelChannel,
    removeModelChannel,
    addWorkflowChannel,
    removeWorkflowChannel,
    selectModelChannel,
    selectWorkflowChannel,
    addPreset,
    removePreset,
    resetAll,
  };
});

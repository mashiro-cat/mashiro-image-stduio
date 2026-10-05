<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type {
  AppSettings,
  DebugConfig,
  ImageQuality,
  ImageResponseFormat,
  ModelApiConfig,
  WorkflowApiConfig,
  WorkflowInput,
  WorkflowNodeRole,
  WorkflowPreset,
} from "../types";
import { NODE_ROLE_META, NODE_ROLE_ORDER } from "../types";
import { localeOptions, nodeRoleLabel, t } from "../i18n";
import {
  aspectOptions,
  qualityOptions,
  responseFormatOptions,
  createWorkflowInput,
  createWorkflowPreset,
  relabelInputs,
  sortInputs,
  useSettingsStore,
} from "../stores/settings";
import { useHistoryStore } from "../stores/history";
import { useCollectionsStore } from "../stores/collections";
import { usePromptStore } from "../stores/prompts";
import { usePresetsStore, type StylePreset } from "../stores/presets";
import { useDraftStore } from "../stores/draft";
import { useUiStore } from "../stores/ui";
import { useDebugLogStore } from "../stores/debugLog";
import { testModelApi } from "../services/modelApi";
import {
  analyzeWorkflow,
  getWorkflowJson,
  pickFieldName,
  suggestWorkflowInputs,
  testWorkflowApi,
  type WorkflowNodeInfo,
} from "../services/workflowApi";
import { listModels, testLlm } from "../services/llmApi";
import { dataRoot, probeStorage, removeDataDir, revealDataDir, type StorageProbeResult } from "../platform/storage";
import { isTauri, uid } from "../platform/env";
import UiIcon from "../components/ui/UiIcon.vue";
import UiSecretInput from "../components/ui/UiSecretInput.vue";
import UiSwitch from "../components/ui/UiSwitch.vue";
import UiSegmented from "../components/ui/UiSegmented.vue";
import UiRange from "../components/ui/UiRange.vue";
import UiTagInput from "../components/ui/UiTagInput.vue";
import UiNumber from "../components/ui/UiNumber.vue";
import McpServicePanel from "../components/settings/McpServicePanel.vue";
import UpscalePanel from "../components/settings/UpscalePanel.vue";

const route = useRoute();
const router = useRouter();
const settings = useSettingsStore();
const history = useHistoryStore();
const collections = useCollectionsStore();
const prompts = usePromptStore();
const presets = usePresetsStore();
const draft = useDraftStore();
const ui = useUiStore();
const debugLog = useDebugLogStore();

type TabKey = "model" | "workflow" | "llm" | "general" | "presets" | "debug" | "data" | "mcp" | "upscale";
const TAB_KEYS: TabKey[] = ["model", "workflow", "llm", "general", "presets", "debug", "data", "mcp", "upscale"];

const tab = ref<TabKey>("model");

/**
 * 设置页左侧导航分组。
 *
 * ⚠️ **必须是 computed 而不是模块级常量**：常量在 import 时求值一次，
 * `t()` 拿到的还是启动时的语言——用户切到英文后这里仍显示中文。
 * 词条必须在渲染期取。
 *
 * `key` / `icon` 是数据（tab 标识与图标名），不参与翻译。
 */
const NAV_GROUPS = computed<
  Array<{ title: string; items: Array<{ key: TabKey; label: string; icon: string; desc: string }> }>
>(() => [
  {
    title: t("settings.nav.group.channels"),
    items: [
      { key: "model", label: t("settings.tab.model"), icon: "sparkles", desc: t("settings.tab.model.desc") },
      { key: "workflow", label: t("settings.tab.workflow"), icon: "workflow", desc: t("settings.tab.workflow.desc") },
      { key: "llm", label: t("settings.tab.llm"), icon: "brain", desc: t("settings.tab.llm.desc") },
    ],
  },
  {
    title: t("settings.nav.group.appData"),
    items: [
      { key: "general", label: t("settings.tab.general"), icon: "slider", desc: t("settings.tab.general.desc") },
      { key: "presets", label: t("settings.tab.presets"), icon: "layers", desc: t("settings.tab.presets.desc") },
      { key: "debug", label: t("settings.tab.debug"), icon: "bug", desc: t("settings.tab.debug.desc") },
      { key: "data", label: t("settings.tab.data"), icon: "database", desc: t("settings.tab.data.desc") },
    ],
  },
  {
    title: t("settings.nav.group.extensions"),
    items: [
      { key: "upscale", label: t("settings.tab.upscale"), icon: "spark", desc: t("settings.tab.upscale.desc") },
      { key: "mcp", label: t("settings.tab.mcp"), icon: "plug", desc: t("settings.tab.mcp.desc") },
    ],
  },
]);

/** tab 写进 URL，便于从顶栏直接跳到某一项 */
function setTab(next: TabKey) {
  tab.value = next;
  void router.replace({ path: "/settings", query: { tab: next } });
}

watch(
  () => route.query.tab,
  (value) => {
    const next = String(value ?? "") as TabKey;
    if (TAB_KEYS.includes(next) && next !== tab.value) tab.value = next;
  },
  { immediate: true },
);

const testing = ref("");
const rootPath = ref("");
const modelOptions = ref<string[]>([]);
const analysis = ref<Record<string, WorkflowNodeInfo[]>>({});
/** 展开的渠道卡片（按 tab 各自维护） */
const openModelId = ref("");
const openWorkflowId = ref("");

const ready = (channel: { enabled: boolean; apiKey: string }) => Boolean(channel.apiKey);
const llmReady = computed(() => Boolean(settings.state.llm.baseUrl && settings.state.llm.apiKey));
const presetTotal = computed(() =>
  settings.state.workflowApi.channels.reduce((sum, channel) => sum + channel.presets.length, 0),
);

function statusTag(ok: boolean) {
  return ok
    ? { text: t("settings.channel.status.configured"), cls: "tag-success" }
    : { text: t("settings.channel.status.notConfigured"), cls: "tag-warning" };
}

/** 渠道卡片上的密钥状态：与启用状态分开表达，避免「已配置 + 已停用」看着矛盾 */
function keyTag(ok: boolean) {
  return ok
    ? { text: t("settings.channel.status.keyFilled"), cls: "tag-success" }
    : { text: t("settings.channel.status.keyMissing"), cls: "tag-warning" };
}

/** 默认展开「当前使用中」的渠道（没有可用渠道时展开第一个），此后尊重用户的收起操作 */
watch(
  () => [settings.loaded, settings.activeModelChannel?.id, settings.state.modelApi.channels[0]?.id] as const,
  ([loaded, activeId, firstId]) => {
    if (!loaded || openModelId.value) return;
    openModelId.value = activeId ?? firstId ?? "";
  },
  { immediate: true },
);
watch(
  () => [settings.loaded, settings.activeWorkflowChannel?.id, settings.state.workflowApi.channels[0]?.id] as const,
  ([loaded, activeId, firstId]) => {
    if (!loaded || openWorkflowId.value) return;
    openWorkflowId.value = activeId ?? firstId ?? "";
  },
  { immediate: true },
);

onMounted(async () => {
  rootPath.value = (await dataRoot()) ?? "";
});

/* ------------------------------------------------------------ 连接测试 */

async function testModelChannel(channel: ModelApiConfig) {
  testing.value = `model:${channel.id}`;
  try {
    if (!channel.apiKey || !channel.baseUrl) throw new Error(t("settings.model.missingEndpoint"));
    const message = await testModelApi(channel);
    ui.success(t("settings.channel.testOk", { name: channel.name }), message);
  } catch (err) {
    ui.requestFailed(t("settings.channel.testFailed"), err);
  } finally {
    testing.value = "";
  }
}

async function testWorkflowChannel(channel: WorkflowApiConfig, workflowId?: string) {
  testing.value = `workflow:${channel.id}${workflowId ?? ""}`;
  try {
    if (!channel.apiKey) throw new Error(t("settings.workflow.missingApiKey"));
    const message = await testWorkflowApi(channel, workflowId ?? "");
    ui.success(t("settings.channel.testOk", { name: channel.name }), message);
  } catch (err) {
    ui.requestFailed(t("settings.channel.testFailed"), err);
  } finally {
    testing.value = "";
  }
}

async function runLlmTest() {
  testing.value = "llm";
  try {
    if (!llmReady.value) throw new Error(t("settings.llm.missingEndpoint"));
    const message = await testLlm(settings.state.llm);
    ui.success(t("settings.llm.testOk"), message);
  } catch (err) {
    ui.requestFailed(t("settings.channel.testFailed"), err);
  } finally {
    testing.value = "";
  }
}

async function fetchModels() {
  testing.value = "models";
  try {
    if (!llmReady.value) throw new Error(t("settings.llm.missingEndpoint"));
    const list = await listModels(settings.state.llm);
    modelOptions.value = list;
    ui.success(t("settings.llm.modelsOk"), t("settings.llm.modelsOkDetail", { count: list.length }));
  } catch (err) {
    ui.error(t("settings.llm.modelsFailed"), t("settings.llm.modelsFailedDetail", { detail: ui.describe(err).slice(0, 160) }));
  } finally {
    testing.value = "";
  }
}

/* ------------------------------------------------------------ 渠道管理 */

function addModelChannel() {
  const channel = settings.addModelChannel();
  openModelId.value = channel.id;
}

function addWorkflowChannel() {
  const channel = settings.addWorkflowChannel();
  openWorkflowId.value = channel.id;
}

async function dropModelChannel(channel: ModelApiConfig) {
  if (settings.state.modelApi.channels.length <= 1) {
    ui.warning(t("settings.channel.keepOne.title"), t("settings.channel.keepOne.message"));
    return;
  }
  const ok = await ui.confirm({
    title: t("settings.channel.deleteTitle", { name: channel.name }),
    message: t("settings.channel.deleteMessage"),
    confirmText: t("common.delete"),
    tone: "danger",
  });
  if (!ok) return;
  settings.removeModelChannel(channel.id);
  if (openModelId.value === channel.id) openModelId.value = settings.activeModelChannel?.id ?? "";
  ui.success(t("settings.channel.deleted"));
}

async function dropWorkflowChannel(channel: WorkflowApiConfig) {
  if (settings.state.workflowApi.channels.length <= 1) {
    ui.warning(t("settings.channel.keepOne.title"), t("settings.channel.keepOne.message"));
    return;
  }
  const ok = await ui.confirm({
    title: t("settings.channel.deleteTitle", { name: channel.name }),
    message: t("settings.workflow.deleteChannelMessage", { count: channel.presets.length }),
    confirmText: t("common.delete"),
    tone: "danger",
  });
  if (!ok) return;
  settings.removeWorkflowChannel(channel.id);
  if (openWorkflowId.value === channel.id) openWorkflowId.value = settings.activeWorkflowChannel?.id ?? "";
  ui.success(t("settings.channel.deleted"));
}

/** 工作台当前使用的渠道：只有「启用 + 已填密钥」才能设为默认 */
function pickModelChannel(id: string) {
  if (settings.selectModelChannel(id)) {
    ui.success(t("settings.channel.switched"), t("settings.channel.switchedDetail"));
  } else {
    ui.warning(t("settings.channel.unavailable.title"), t("settings.channel.unavailable.message"));
  }
}

function pickWorkflowChannel(id: string) {
  if (settings.selectWorkflowChannel(id)) {
    ui.success(t("settings.channel.switchedWorkflow"));
  } else {
    ui.warning(t("settings.channel.unavailable.title"), t("settings.workflow.unavailable.message"));
  }
}

/* ------------------------------------------------------------ 工作流预设 */

function addPresetTo(channel: WorkflowApiConfig) {
  const preset = createWorkflowPreset({ name: `工作流 ${channel.presets.length + 1}` });
  channel.presets.push(preset);
  openWorkflowId.value = channel.id;
  if (settings.activeWorkflowChannel?.id === channel.id) settings.activePresetId = preset.id;
}

async function removePresetFrom(channel: WorkflowApiConfig, preset: WorkflowPreset) {
  const ok = await ui.confirm({
    title: t("settings.workflow.preset.deleteTitle", { name: preset.name }),
    message: t("settings.workflow.preset.deleteMessage"),
    confirmText: t("common.delete"),
    tone: "danger",
  });
  if (!ok) return;
  channel.presets = channel.presets.filter((item) => item.id !== preset.id);
  if (settings.activePresetId === preset.id) {
    settings.activePresetId = channel.presets[0]?.id ?? "";
  }
  ui.success(t("settings.workflow.preset.deleted"));
}

async function analyzeAndMap(channel: WorkflowApiConfig, preset: WorkflowPreset) {
  if (!preset.workflowId) {
    ui.warning(t("settings.workflow.preset.analyzeMissingId"));
    return;
  }
  testing.value = `analyze:${preset.id}`;
  try {
    const json = await getWorkflowJson(channel, preset.workflowId);
    const nodes = analyzeWorkflow(json);
    analysis.value = { ...analysis.value, [preset.id]: nodes };
    // 识别建议只做「补齐」：已有的槽位（含用户手动加的）原样保留
    const added = mergeSuggestedInputs(preset, suggestWorkflowInputs(nodes));
    ui.success(t("settings.workflow.preset.analyzeOk"), t("settings.workflow.preset.analyzeOkDetail", { count: nodes.length, added }));
  } catch (err) {
    ui.requestFailed(t("settings.workflow.preset.analyzeFailed"), err);
  } finally {
    testing.value = "";
  }
}

/* ------------------------------------------------------------ 输入槽位编辑 */

/** 该节点是否已经占了某个角色的槽位 */
function inputOf(preset: WorkflowPreset, role: WorkflowNodeRole, nodeId: string) {
  return preset.nodes.inputs.find((input) => input.role === role && input.nodeId === nodeId);
}

function refresh(preset: WorkflowPreset) {
  preset.nodes.inputs = relabelInputs(sortInputs(preset.nodes.inputs));
}

/**
 * 点识别结果行上的标签 = 增删一个输入槽位。
 * 一个节点可以同时占多个角色（KSampler 既给 steps 也给 seed），
 * 再点一次同一个标签即移除，避免又只能靠猜的「点了没反应」。
 *
 * 字段名取自该节点 inputs 里真实存在的名字：接口按 `nodeId` 找到节点后
 * 还得按 `fieldName` 取 input，名字对不上会直接拒单（803 NODE_INFO_MISMATCH）。
 */
function toggleNodeInput(preset: WorkflowPreset, role: WorkflowNodeRole, nodeId: string) {
  const existing = inputOf(preset, role, nodeId);
  if (existing) {
    preset.nodes.inputs = preset.nodes.inputs.filter((input) => input.id !== existing.id);
    refresh(preset);
    return;
  }
  const info = analysis.value[preset.id]?.find((node) => node.nodeId === nodeId);
  const fieldName =
    info?.fieldNames[role] || (info ? pickFieldName(info.fields, role) : "") || NODE_ROLE_META[role].defaultField;
  preset.nodes.inputs.push({ ...createWorkflowInput(role, { nodeId, fieldName }), id: uid("in") });
  refresh(preset);
}

/** 补上还没占位的识别建议，返回新增数量 */
function mergeSuggestedInputs(preset: WorkflowPreset, suggestions: WorkflowInput[]) {
  let added = 0;
  for (const suggestion of suggestions) {
    const occupied = inputOf(preset, suggestion.role, suggestion.nodeId);
    if (occupied) {
      // 已存在但节点 ID 是手填的空壳，顺便把识别出的字段名补上
      if (!occupied.fieldName) occupied.fieldName = suggestion.fieldName;
      continue;
    }
    // 该角色已经手动填过同一个节点就不重复加
    preset.nodes.inputs.push({ ...suggestion, id: uid("in") });
    added += 1;
  }
  refresh(preset);
  return added;
}

/** 手动添加一个空槽位（节点 ID 待填） */
function addBlankInput(preset: WorkflowPreset, role: WorkflowNodeRole) {
  preset.nodes.inputs.push(createWorkflowInput(role));
  refresh(preset);
}

function removeInput(preset: WorkflowPreset, inputId: string) {
  preset.nodes.inputs = preset.nodes.inputs.filter((input) => input.id !== inputId);
  refresh(preset);
}

function patchInput(target: WorkflowInput, patch: Partial<WorkflowInput>) {
  Object.assign(target, patch);
}

/**
 * 角色展示名。
 *
 * ⚠️ **必须走 `nodeRoleLabel()` 而不是 `NODE_ROLE_META[role].label`**：
 * 后者是**会被持久化进预设的数据**（`relabelInputs()` 拿它拼成「输入图片 2」
 * 存进 `nodes.inputs[].label`），文案固定；界面要按当前语言显示。
 *
 * 做成函数而不是常量：常量在 import 时求值一次，切语言后标签不会更新。
 * `unknown` 这个伪角色只是筛选时的兜底分类，不参与持久化。
 */
function roleLabel(role: string): string {
  if (role === "unknown") return t("settings.workflow.input.roleUnknown");
  return NODE_ROLE_ORDER.includes(role as WorkflowNodeRole) ? nodeRoleLabel(role as WorkflowNodeRole) : role;
}

/** 判断某个角色是否为「识别建议」，用于把标签高亮出来 */
function isSuggested(node: WorkflowNodeInfo, role: WorkflowNodeRole) {
  return node.role === role || node.roles.includes(role);
}

/** 已填了节点 ID 的槽位数（用于「N 个输入」徽标） */
function filledInputs(preset: WorkflowPreset | undefined) {
  return preset?.nodes.inputs.filter((input) => input.nodeId.trim()).length ?? 0;
}

/* ------------------------------------------------------------ 数据管理 */

async function openDataDir() {
  const res = await revealDataDir();
  if (!res.ok) ui.warning(t("settings.data.openDirFailed"), res.error ?? t("settings.data.openDirFallback"));
}

async function clearAllData() {
  const ok = await ui.confirm({
    title: t("settings.data.clearTitle"),
    message: t("settings.data.clearMessage", {
      history: history.stats.total,
      prompts: prompts.items.length,
    }),
    confirmText: t("settings.data.clearConfirm"),
    tone: "danger",
  });
  if (!ok) return;
  history.clearAll();
  prompts.items.forEach((item) => prompts.remove(item.id));
  collections.resetAll();
  presets.resetToDefault();
  await removeDataDir();
  await settings.resetAll();
  rootPath.value = (await dataRoot()) ?? "";
  openModelId.value = settings.activeModelChannel?.id ?? "";
  openWorkflowId.value = settings.activeWorkflowChannel?.id ?? "";
  ui.success(t("settings.data.cleared"));
}

function resetDraft() {
  draft.reset();
  draft.patch({ size: settings.state.app.defaultSize, count: settings.state.app.defaultCount });
  ui.success(t("settings.general.draftReset"));
}

/* ------------------------------------------------------------ 预设中心 */

/** 默认风格下拉跟随可编辑的风格预设，不再硬编码 */
const styleOptions = computed(() => [
  { label: t("settings.general.styleFollowImage"), value: "" },
  ...presets.styles.map((item) => ({ label: item.label, value: item.label })),
]);

function addStylePreset() {
  presets.addStyle({ label: `新风格 ${presets.styles.length + 1}`, value: "" });
  ui.success(t("settings.presets.added"), t("settings.presets.addedDetail"));
}

async function removeStylePreset(item: StylePreset) {
  const ok = await ui.confirm({
    title: t("settings.presets.deleteTitle", { name: item.label }),
    message: t("settings.presets.deleteMessage"),
    confirmText: t("common.delete"),
    tone: "danger",
  });
  if (!ok) return;
  presets.removeStyle(item.id);
  // 默认风格若指向被删的这一条，同步清掉，避免留下无效值
  if (settings.state.app.defaultStyle === item.label) settings.state.app.defaultStyle = "";
  ui.success(t("settings.presets.deleted"));
}

function restoreStyles() {
  const added = presets.restoreDefaultStyles();
  ui.success(added ? t("settings.presets.restored", { count: added }) : t("settings.presets.restoreNotNeeded"));
}

/* 参数预设已整块移除：模型固定时它只剩「省点点击」，
   而 size/count/quality 由 draft 持久化保存，下次打开工作台还在。
   「预设中心」现在只剩风格预设——改的是提示词内容，才是真正的杠杆。 */

const dirHint = computed(() =>
  isTauri() ? rootPath.value || t("settings.data.dirHint.loading") : t("settings.data.dirHint.browser"),
);

function numFrom(event: Event): number {
  return Number((event.target as HTMLInputElement).value);
}

function setModelQuality(channel: ModelApiConfig, value: string) {
  channel.quality = value as ImageQuality;
}

function setResponseFormat(channel: ModelApiConfig, value: string) {
  channel.responseFormat = value as ImageResponseFormat;
}

function setPresetInstance(preset: WorkflowPreset, value: string) {
  preset.instanceType = value as "default" | "plus" | "ultra";
}

function setTheme(value: string) {
  settings.state.app.theme = value as "light" | "dark";
  settings.applyTheme();
}

/**
 * 切换界面语言。
 *
 * 与 setTheme 同套路：写进设置后立刻 `applyLocale()`，
 * 不依赖 App.vue 的 watcher（那只是兜底，用户点了就该马上看到变化）。
 */
function setLocale(value: AppSettings["locale"]) {
  settings.state.app.locale = value;
  settings.applyLocale();
}

/**
 * 调试开关：写入设置后立刻同步到请求层，不依赖全局 watcher，
 * 确保「打开即生效」，并给出明确反馈。
 */
function setDebug(patch: Partial<DebugConfig>) {
  Object.assign(settings.state.debug, patch);
  debugLog.syncRuntime();
  if (patch.enabled !== undefined) {
    if (patch.enabled) ui.success(t("settings.debug.toast.on"), t("settings.debug.toast.onDetail"));
    else ui.info(t("settings.debug.toast.off"), t("settings.debug.toast.offDetail"));
  }
}

const probing = ref(false);
const probeResult = ref<StorageProbeResult | null>(null);

async function runStorageProbe() {
  probing.value = true;
  try {
    const result = await probeStorage();
    probeResult.value = result;
    if (result.ok) ui.success(t("settings.data.probeOk"), result.message);
    else ui.error(t("settings.data.probeFailed"), result.message);
  } finally {
    probing.value = false;
  }
}

const sweeping = ref(false);

async function runSweepOrphans() {
  if (sweeping.value) return;
  sweeping.value = true;
  try {
    const removed = await history.sweepOrphans();
    if (removed > 0) ui.success(t("settings.data.sweepDone"), t("settings.data.sweepDoneDetail", { count: removed }));
    else ui.info(t("settings.data.sweepNone"), t("settings.data.sweepNoneDetail"));
  } finally {
    sweeping.value = false;
  }
}
</script>

<template>
  <div class="page">
    <div class="page-inner">
      <div class="page-head">
        <div>
          <h1 class="page-title">{{ t("settings.page.title") }}</h1>
          <p class="page-sub">{{ t("settings.page.sub") }}</p>
        </div>
        <div class="row gap-2 wrap">
          <span class="tag" :class="settings.enabledModelChannels.length ? 'tag-success' : 'tag-warning'">
            {{ t("settings.page.tag.modelChannels", { count: settings.enabledModelChannels.length }) }}
          </span>
          <span class="tag" :class="settings.enabledWorkflowChannels.length ? 'tag-success' : 'tag-warning'">
            {{ t("settings.page.tag.workflowChannels", { count: settings.enabledWorkflowChannels.length }) }}
          </span>
          <span class="tag" :class="statusTag(llmReady).cls">
            {{ t("settings.page.tag.llm", { status: statusTag(llmReady).text }) }}
          </span>
        </div>
      </div>

      <div class="layout">
        <nav class="side card">
          <template v-for="group in NAV_GROUPS" :key="group.title">
            <p class="side-group">{{ group.title }}</p>
            <button
              v-for="item in group.items"
              :key="item.key"
              class="side-item"
              :class="{ 'is-active': tab === item.key }"
              @click="setTab(item.key)"
            >
              <span class="side-icon"><UiIcon :name="item.icon" :size="16" /></span>
              <span class="grow" style="min-width: 0">
                <span class="side-label">{{ item.label }}</span>
                <span class="side-desc t-ellipsis">{{ item.desc }}</span>
              </span>
              <UiIcon name="chevron-right" :size="14" class="t-faint" />
            </button>
          </template>
        </nav>

        <div class="content">
          <!-- ============================================ 生图渠道 -->
          <section v-show="tab === 'model'" class="sec">
            <div class="card card-pad intro">
              <div>
                <h2 class="sec-title">{{ t("settings.model.title") }}</h2>
                <p class="sec-sub">
                  {{ t("settings.model.sub") }}<code>POST /v1/images/generations</code>, <code>POST /v1/images/edits</code>.<strong>{{ t("settings.model.sub.strong") }}</strong>{{ t("settings.model.sub.tail") }}
                </p>
              </div>
              <button class="btn btn-sm btn-primary" @click="addModelChannel">
                <UiIcon name="plus" :size="14" />{{ t("settings.model.addChannel") }}
              </button>
            </div>

            <div class="channel-list">
              <article
                v-for="channel in settings.state.modelApi.channels"
                :key="channel.id"
                class="channel card"
                :class="{ 'is-off': !channel.enabled, 'is-current': settings.activeModelChannel?.id === channel.id }"
              >
                <header class="channel-head">
                  <button class="channel-caret" :title="openModelId === channel.id ? t('settings.channel.collapse') : t('settings.channel.expand')" @click="openModelId = openModelId === channel.id ? '' : channel.id">
                    <UiIcon :name="openModelId === channel.id ? 'chevron-up' : 'chevron-down'" :size="15" />
                  </button>
                  <span class="channel-icon"><UiIcon name="sparkles" :size="15" /></span>
                  <input v-model="channel.name" class="channel-name" :placeholder="t('settings.channel.namePlaceholder')" />
                  <span v-if="settings.activeModelChannel?.id === channel.id" class="tag tag-accent">{{ t("settings.channel.inUse") }}</span>
                  <span class="tag" :class="keyTag(ready(channel)).cls">{{ keyTag(ready(channel)).text }}</span>
                  <span v-if="!channel.enabled" class="tag tag-warning">{{ t("settings.channel.disabled") }}</span>
                  <span class="grow" />
                  <UiSwitch v-model="channel.enabled" :aria-label="t('settings.channel.enable')" />
                  <button
                    v-if="settings.activeModelChannel?.id !== channel.id"
                    class="btn btn-sm btn-ghost"
                    :disabled="!ready(channel)"
                    :title="ready(channel) ? t('settings.channel.setDefaultTitle') : t('settings.model.missingEndpoint')"
                    @click="pickModelChannel(channel.id)"
                  >
                    {{ t("settings.channel.setDefault") }}
                  </button>
                  <button class="icon-btn" :title="t('settings.channel.delete')" @click="dropModelChannel(channel)">
                    <UiIcon name="trash" :size="15" />
                  </button>
                </header>

                <p v-if="openModelId !== channel.id" class="channel-summary t-xs t-3rd t-ellipsis">
                  {{ channel.baseUrl || t("settings.channel.summary.baseUrlEmpty") }} · {{ channel.model || t("settings.channel.summary.modelEmpty") }} ·
                  {{ ready(channel) ? t("settings.channel.summary.keyFilled") : t("settings.channel.summary.keyEmpty") }}
                </p>

                <div v-else class="channel-body">
                  <div class="form-grid">
                    <label class="field span-2">
                      <span class="field-label">{{ t("settings.model.field.baseUrl") }}</span>
                      <input v-model="channel.baseUrl" class="input" placeholder="https://xxxx.xx" spellcheck="false" />
                      <span class="field-hint">{{ t("settings.model.field.baseUrlHint") }}</span>
                    </label>

                    <label class="field span-2">
                      <span class="field-label">{{ t("settings.model.field.apiKey") }}<span class="req">*</span></span>
                      <UiSecretInput v-model="channel.apiKey" placeholder="sk-..." />
                      <span class="field-hint">{{ t("settings.model.field.apiKeyHint") }}</span>
                    </label>

                    <label class="field">
                      <span class="field-label">{{ t("settings.model.field.defaultModel") }}</span>
                      <input v-model="channel.model" class="input" placeholder="gpt-image-2" spellcheck="false" />
                    </label>

                    <div class="field">
                      <span class="field-label">{{ t("settings.model.field.defaultQuality") }}</span>
                      <UiSegmented
                        :model-value="channel.quality"
                        block
                        :options="qualityOptions()"
                        @update:model-value="(v) => setModelQuality(channel, v)"
                      />
                    </div>

                    <div class="field span-2">
                      <span class="field-label">{{ t("settings.model.field.responseFormat") }}</span>
                      <UiSegmented
                        :model-value="channel.responseFormat"
                        block
                        :options="responseFormatOptions()"
                        @update:model-value="(v) => setResponseFormat(channel, v)"
                      />
                      <span class="field-hint">
                        {{ t("settings.model.field.responseFormatHint") }}
                      </span>
                    </div>

                    <div class="field span-2">
                      <span class="field-label">{{ t("settings.model.field.modelOptions") }}</span>
                      <UiTagInput v-model="channel.modelOptions" :placeholder="t('settings.model.field.modelOptionsPlaceholder')" />
                      <span class="field-hint">{{ t("settings.model.field.modelOptionsHint") }}</span>
                    </div>

                    <div class="field">
                      <span class="field-label">{{ t("settings.model.field.timeout") }}</span>
                      <div class="input-group" style="max-width: 180px">
                        <input
                          class="input"
                          type="number"
                          min="30"
                          max="1800"
                          :value="channel.timeoutSec"
                          @input="channel.timeoutSec = numFrom($event)"
                        />
                        <span class="input-addon" style="padding-right: 11px">{{ t("settings.unit.seconds") }}</span>
                      </div>
                      <span class="field-hint">
                        {{ t("settings.model.field.timeoutHint") }}
                      </span>
                    </div>
                  </div>

                  <footer class="channel-foot">
                    <button
                      class="btn btn-sm"
                      :disabled="testing === `model:${channel.id}`"
                      @click="testModelChannel(channel)"
                    >
                      <UiIcon
                        :name="testing === `model:${channel.id}` ? 'loader' : 'zap'"
                        :size="14"
                        :class="{ spin: testing === `model:${channel.id}` }"
                      />
                      {{ t("settings.channel.test") }}
                    </button>
                    <span class="t-xs t-faint">{{ channel.enabled ? t("settings.channel.enabledHint") : t("settings.channel.disabledHint") }}</span>
                  </footer>
                </div>
              </article>
            </div>
          </section>

          <!-- ============================================ 工作流渠道 -->
          <section v-show="tab === 'workflow'" class="sec">
            <div class="card card-pad intro">
              <div>
                <h2 class="sec-title">{{ t("settings.workflow.title") }}</h2>
                <p class="sec-sub">
                  {{ t("settings.workflow.sub") }}<code>/task/openapi/create</code> <code>/openapi/v2/query</code><strong>{{ t("settings.workflow.sub.strong") }}</strong>。
                </p>
              </div>
              <button class="btn btn-sm btn-primary" @click="addWorkflowChannel">
                <UiIcon name="plus" :size="14" />{{ t("settings.workflow.addChannel") }}
              </button>
            </div>

            <div class="channel-list">
              <article
                v-for="channel in settings.state.workflowApi.channels"
                :key="channel.id"
                class="channel card"
                :class="{ 'is-off': !channel.enabled, 'is-current': settings.activeWorkflowChannel?.id === channel.id }"
              >
                <header class="channel-head">
                  <button class="channel-caret" :title="openWorkflowId === channel.id ? t('settings.channel.collapse') : t('settings.channel.expand')" @click="openWorkflowId = openWorkflowId === channel.id ? '' : channel.id">
                    <UiIcon :name="openWorkflowId === channel.id ? 'chevron-up' : 'chevron-down'" :size="15" />
                  </button>
                  <span class="channel-icon"><UiIcon name="workflow" :size="15" /></span>
                  <input v-model="channel.name" class="channel-name" :placeholder="t('settings.channel.namePlaceholder')" />
                  <span v-if="settings.activeWorkflowChannel?.id === channel.id" class="tag tag-accent">{{ t("settings.channel.inUse") }}</span>
                  <span class="tag">{{ t("settings.workflow.presetCountTag", { count: channel.presets.length }) }}</span>
                  <span class="tag" :class="keyTag(ready(channel)).cls">{{ keyTag(ready(channel)).text }}</span>
                  <span v-if="!channel.enabled" class="tag tag-warning">{{ t("settings.channel.disabled") }}</span>
                  <span class="grow" />
                  <UiSwitch v-model="channel.enabled" :aria-label="t('settings.channel.enable')" />
                  <button
                    v-if="settings.activeWorkflowChannel?.id !== channel.id"
                    class="btn btn-sm btn-ghost"
                    :disabled="!ready(channel)"
                    :title="ready(channel) ? t('settings.channel.setDefaultTitle') : t('settings.workflow.setDefaultTitleDisabled')"
                    @click="pickWorkflowChannel(channel.id)"
                  >
                    {{ t("settings.channel.setDefault") }}
                  </button>
                  <button class="icon-btn" :title="t('settings.channel.delete')" @click="dropWorkflowChannel(channel)">
                    <UiIcon name="trash" :size="15" />
                  </button>
                </header>

                <p v-if="openWorkflowId !== channel.id" class="channel-summary t-xs t-3rd t-ellipsis">
                  {{ channel.baseUrl || t("settings.channel.summary.baseUrlEmpty") }} · {{ ready(channel) ? t("settings.channel.summary.keyFilled") : t("settings.channel.summary.keyEmpty") }}
                </p>

                <div v-else class="channel-body">
                  <div class="form-grid">
                    <label class="field span-2">
                      <span class="field-label">{{ t("settings.model.field.baseUrl") }}</span>
                      <input v-model="channel.baseUrl" class="input" placeholder="https://www.runninghub.cn" spellcheck="false" />
                    </label>

                    <label class="field span-2">
                      <span class="field-label">{{ t("settings.workflow.field.apiKey") }}<span class="req">*</span></span>
                      <UiSecretInput v-model="channel.apiKey" />
                      <span class="field-hint">{{ t("settings.workflow.field.apiKeyHint") }}</span>
                    </label>

                    <div class="field">
                      <span class="field-label">{{ t("settings.workflow.field.pollInterval") }}</span>
                      <div class="input-group">
                        <input class="input" type="number" min="2" max="30" :value="channel.pollIntervalSec" @input="channel.pollIntervalSec = numFrom($event)" />
                        <span class="input-addon" style="padding-right: 11px">{{ t("settings.unit.seconds") }}</span>
                      </div>
                    </div>

                    <div class="field">
                      <span class="field-label">{{ t("settings.workflow.field.pollTimeout") }}</span>
                      <div class="input-group">
                        <input class="input" type="number" min="30" max="3600" :value="channel.pollTimeoutSec" @input="channel.pollTimeoutSec = numFrom($event)" />
                        <span class="input-addon" style="padding-right: 11px">{{ t("settings.unit.seconds") }}</span>
                      </div>
                    </div>

                    <div class="field">
                      <span class="field-label">{{ t("settings.workflow.field.retainSeconds") }}</span>
                      <div class="input-group">
                        <input class="input" type="number" min="0" max="180" :value="channel.retainSeconds" @input="channel.retainSeconds = numFrom($event)" />
                        <span class="input-addon" style="padding-right: 11px">{{ t("settings.unit.seconds") }}</span>
                      </div>
                      <span class="field-hint">{{ t("settings.workflow.field.retainHint") }}</span>
                    </div>

                    <div class="field">
                      <span class="field-label">{{ t("settings.workflow.field.addMetadata") }}</span>
                      <UiSwitch v-model="channel.addMetadata" :label="t('settings.workflow.field.addMetadataLabel')" :hint="t('settings.workflow.field.addMetadataHint')" />
                    </div>
                  </div>

                  <footer class="channel-foot">
                    <button
                      class="btn btn-sm"
                      :disabled="testing === `workflow:${channel.id}`"
                      @click="testWorkflowChannel(channel)"
                    >
                      <UiIcon
                        :name="testing === `workflow:${channel.id}` ? 'loader' : 'zap'"
                        :size="14"
                        :class="{ spin: testing === `workflow:${channel.id}` }"
                      />
                      {{ t("settings.channel.test") }}
                    </button>
                    <span class="grow" />
                    <button class="btn btn-sm btn-primary" @click="addPresetTo(channel)">
                      <UiIcon name="plus" :size="14" />{{ t("settings.workflow.preset.add") }}
                    </button>
                  </footer>

                  <div class="preset-block">
                    <div class="row-between">
                      <span class="section-label">{{ t("settings.workflow.preset.blockTitle") }}</span>
                      <span class="t-xs t-faint">{{ t("settings.workflow.preset.blockHint") }}</span>
                    </div>

                    <div v-if="!channel.presets.length" class="empty-preset">
                      <span class="empty-icon"><UiIcon name="workflow" :size="20" /></span>
                      <p class="t-md t-2nd">{{ t("settings.workflow.preset.empty") }}</p>
                      <p class="t-xs t-3rd">{{ t("settings.workflow.preset.emptyHint") }}</p>
                      <button class="btn btn-primary btn-sm" @click="addPresetTo(channel)">
                        <UiIcon name="plus" :size="14" />{{ t("settings.workflow.preset.add") }}
                      </button>
                    </div>

                    <div v-else class="preset-list">
                      <article v-for="preset in channel.presets" :key="preset.id" class="preset">
                        <header class="preset-head">
                          <span class="preset-icon"><UiIcon name="workflow" :size="16" /></span>
                          <input v-model="preset.name" class="preset-name-input" :placeholder="t('settings.workflow.preset.namePlaceholder')" />
                          <span v-if="settings.activePresetId === preset.id" class="tag tag-accent">{{ t("settings.workflow.preset.current") }}</span>
                          <button v-else class="btn btn-sm btn-ghost" @click="settings.activePresetId = preset.id">
                            {{ t("settings.workflow.preset.setCurrent") }}
                          </button>
                          <button class="icon-btn" :title="t('settings.workflow.preset.delete')" @click="removePresetFrom(channel, preset)">
                            <UiIcon name="trash" :size="15" />
                          </button>
                        </header>

                        <div class="form-grid is-compact">
                          <label class="field">
                            <span class="field-label">{{ t("settings.workflow.preset.field.workflowId") }}<span class="req">*</span></span>
                            <div class="row gap-2">
                              <input v-model="preset.workflowId" class="input" placeholder="1904136902449209346" spellcheck="false" />
                              <button
                                class="btn btn-sm"
                                :disabled="testing === `analyze:${preset.id}`"
                                :title="t('settings.workflow.preset.analyzeTitle')"
                                @click="analyzeAndMap(channel, preset)"
                              >
                                <UiIcon
                                  :name="testing === `analyze:${preset.id}` ? 'loader' : 'search'"
                                  :size="14"
                                  :class="{ spin: testing === `analyze:${preset.id}` }"
                                />
                                {{ t("settings.workflow.preset.analyze") }}
                              </button>
                            </div>
                          </label>

                          <label class="field">
                            <span class="field-label">{{ t("settings.workflow.preset.field.accessPassword") }}</span>
                            <input v-model="preset.accessPassword" class="input" :placeholder="t('settings.workflow.preset.field.accessPasswordPlaceholder')" spellcheck="false" />
                          </label>

                          <div class="field">
                            <span class="field-label">{{ t("settings.workflow.field.instanceType") }}</span>
                            <UiSegmented
                              :model-value="preset.instanceType"
                              block
                              :options="[
                                { label: '24G', value: 'default' },
                                { label: '48G', value: 'plus' },
                                { label: '84G', value: 'ultra' },
                              ]"
                              @update:model-value="(v) => setPresetInstance(preset, v)"
                            />
                          </div>

                          <div class="field span-2">
                            <div class="row-between">
                              <span class="field-label">{{ t("settings.workflow.input.title") }}</span>
                              <span class="t-xs t-faint">
                                {{ t("settings.workflow.input.hint") }}
                              </span>
                            </div>

                            <div v-if="preset.nodes.inputs.length" class="input-list">
                              <div v-for="input in preset.nodes.inputs" :key="input.id" class="input-row">
                                <span class="input-role">
                                  <UiIcon :name="NODE_ROLE_META[input.role].icon" :size="13" />
                                  {{ input.label }}
                                </span>
                                <input
                                  class="input"
                                  :value="input.nodeId"
                                  :placeholder="t('settings.workflow.input.nodeIdPlaceholder')"
                                  spellcheck="false"
                                  @input="patchInput(input, { nodeId: ($event.target as HTMLInputElement).value.trim() })"
                                />
                                <input
                                  class="input field-name"
                                  :value="input.fieldName"
                                  :placeholder="NODE_ROLE_META[input.role].defaultField"
                                  :title="t('settings.workflow.input.fieldNameTitle')"
                                  spellcheck="false"
                                  @input="patchInput(input, { fieldName: ($event.target as HTMLInputElement).value.trim() })"
                                />
                                <button class="icon-btn" :title="t('settings.workflow.input.remove')" @click="removeInput(preset, input.id)">
                                  <UiIcon name="trash" :size="14" />
                                </button>
                              </div>
                            </div>
                            <p v-else class="field-hint">
                              {{ t("settings.workflow.input.empty") }}
                            </p>

                            <div class="add-row">
                              <span class="t-xs t-3rd">{{ t("settings.workflow.input.addLabel") }}</span>
                              <button
                                v-for="role in NODE_ROLE_ORDER"
                                :key="role"
                                class="role-chip is-add"
                                :title="t('settings.workflow.input.addRoleTitle', { name: NODE_ROLE_META[role].label })"
                                @click="addBlankInput(preset, role)"
                              >
                                {{ NODE_ROLE_META[role].short }}
                              </button>
                              <span class="grow" />
                              <span class="t-xs t-faint">{{ t("settings.workflow.input.filledCount", { count: filledInputs(preset) }) }}</span>
                            </div>
                          </div>

                          <label class="field span-2">
                            <span class="field-label">{{ t("settings.workflow.preset.field.note") }}</span>
                            <input v-model="preset.note" class="input" :placeholder="t('settings.workflow.preset.field.notePlaceholder')" />
                          </label>
                        </div>

                        <div v-if="analysis[preset.id]?.length" class="analysis">
                          <div class="row-between">
                            <p class="section-label">{{ t("settings.workflow.analysis.title", { count: analysis[preset.id].length }) }}</p>
                            <span class="t-xs t-faint">{{ t("settings.workflow.analysis.hint") }}</span>
                          </div>
                          <div class="analysis-list">
                            <div
                              v-for="node in analysis[preset.id]"
                              :key="node.nodeId"
                              class="analysis-row"
                            >
                              <span class="analysis-id">#{{ node.nodeId }}</span>
                              <span class="analysis-title t-ellipsis">{{ node.title }}</span>
                              <span class="analysis-type t-ellipsis">{{ node.classType }}</span>
                              <span class="analysis-role">
                                <span class="tag" :class="node.role !== 'unknown' ? 'tag-accent' : ''">
                                  {{ roleLabel(node.role) }}
                                </span>
                              </span>
                              <span class="role-chips">
                                <button
                                  v-for="role in NODE_ROLE_ORDER"
                                  :key="role"
                                  class="role-chip"
                                  :class="{
                                    'is-active': Boolean(inputOf(preset, role, node.nodeId)),
                                    'is-suggested': isSuggested(node, role),
                                  }"
                                  :title="inputOf(preset, role, node.nodeId) ? t('settings.workflow.input.chipTitleRemove', { name: NODE_ROLE_META[role].label }) : t('settings.workflow.input.chipTitleAdd', { name: NODE_ROLE_META[role].label })"
                                  @click="toggleNodeInput(preset, role, node.nodeId)"
                                >
                                  {{ NODE_ROLE_META[role].short }}
                                </button>
                              </span>
                            </div>
                          </div>
                        </div>

                        <footer class="preset-foot">
                          <button
                            class="btn btn-sm"
                            :disabled="testing === `workflow:${channel.id}${preset.workflowId}`"
                            @click="testWorkflowChannel(channel, preset.workflowId)"
                          >
                            <UiIcon
                              :name="testing === `workflow:${channel.id}${preset.workflowId}` ? 'loader' : 'zap'"
                              :size="14"
                              :class="{ spin: testing === `workflow:${channel.id}${preset.workflowId}` }"
                            />
                            {{ t("settings.channel.test") }}
                          </button>
                          <span class="t-xs t-faint">
                            {{ t("settings.workflow.input.footFilled", { count: filledInputs(preset) }) }}
                          </span>
                        </footer>
                      </article>
                    </div>
                  </div>
                </div>
              </article>
            </div>
          </section>

          <!-- ============================================ LLM -->
          <section v-show="tab === 'llm'" class="card card-pad sec">
            <header class="sec-head">
              <div>
                <h2 class="sec-title">{{ t("settings.llm.title") }}</h2>
                <p class="sec-sub">
                  {{ t("settings.llm.sub", { baseUrl: "baseUrl" }) }}
                </p>
              </div>
              <div class="row gap-2">
                <span class="tag" :class="statusTag(llmReady).cls">{{ statusTag(llmReady).text }}</span>
                <button class="btn btn-sm" :disabled="testing === 'models'" @click="fetchModels">
                  <UiIcon :name="testing === 'models' ? 'loader' : 'list'" :size="14" :class="{ spin: testing === 'models' }" />
                  {{ t("settings.llm.fetchModels") }}
                </button>
                <button class="btn btn-sm" :disabled="testing === 'llm'" @click="runLlmTest()">
                  <UiIcon :name="testing === 'llm' ? 'loader' : 'zap'" :size="14" :class="{ spin: testing === 'llm' }" />
                  {{ t("settings.channel.test") }}
                </button>
              </div>
            </header>

            <div class="form-grid">
              <label class="field span-2">
                <span class="field-label">{{ t("settings.llm.field.baseUrl") }}</span>
                <input v-model="settings.state.llm.baseUrl" class="input" placeholder="https://api.openai.com/v1" spellcheck="false" />
                <span class="field-hint">{{ t("settings.llm.field.baseUrlHint") }}</span>
              </label>

              <label class="field span-2">
                <span class="field-label">{{ t("settings.llm.field.apiKey") }}<span class="req">*</span></span>
                <UiSecretInput v-model="settings.state.llm.apiKey" />
              </label>

              <label class="field">
                <span class="field-label">{{ t("settings.llm.field.modelName") }}</span>
                <input v-model="settings.state.llm.model" class="input" placeholder="gpt-4o-mini" list="llm-models" spellcheck="false" />
                <datalist id="llm-models">
                  <option v-for="name in modelOptions" :key="name" :value="name" />
                </datalist>
              </label>

              <div class="field">
                <span class="field-label">{{ t("settings.llm.field.temperature") }}</span>
                <UiRange
                  :model-value="settings.state.llm.temperature"
                  :min="0"
                  :max="2"
                  :step="0.05"
                  @update:model-value="settings.state.llm.temperature = $event"
                />
                <span class="field-hint">{{ t("settings.llm.field.temperatureHint") }}</span>
              </div>

              <div class="field">
                <span class="field-label">{{ t("settings.llm.field.maxTokens") }}</span>
                <input
                  class="input"
                  type="number"
                  min="256"
                  max="32000"
                  :value="settings.state.llm.maxTokens"
                  @input="settings.state.llm.maxTokens = numFrom($event)"
                />
              </div>

              <div class="field">
                <span class="field-label">{{ t("settings.llm.field.timeout") }}</span>
                <div class="input-group">
                  <input
                    class="input"
                    type="number"
                    min="10"
                    max="600"
                    :value="settings.state.llm.timeoutSec"
                    @input="settings.state.llm.timeoutSec = numFrom($event)"
                  />
                  <span class="input-addon" style="padding-right: 11px">{{ t("settings.unit.seconds") }}</span>
                </div>
              </div>

              <div class="field span-2">
                <span class="field-label">{{ t("settings.llm.field.enableSection") }}</span>
                <UiSwitch v-model="settings.state.llm.enabled" :label="t('settings.llm.field.enableLabel')" :hint="t('settings.llm.field.enableHint')" />
              </div>

              <div class="field span-2">
                <span class="field-label">{{ t("settings.llm.field.behaviorSection") }}</span>
                <div class="col gap-3">
                  <UiSwitch
                    v-model="settings.state.llm.disableThinking"
                    :label="t('settings.llm.field.thinkingLabel')"
                    :hint="t('settings.llm.field.thinkingHint')"
                  />
                  <UiSwitch
                    v-model="settings.state.llm.jsonMode"
                    :label="t('settings.llm.field.jsonModeLabel')"
                    :hint="t('settings.llm.field.jsonModeHint')"
                  />
                  <UiSwitch
                    v-model="settings.state.llm.sendImages"
                    :label="t('settings.llm.field.sendImagesLabel')"
                    :hint="t('settings.llm.field.sendImagesHint')"
                  />
                </div>
              </div>

              <label class="field span-2">
                <span class="field-label">{{ t("settings.llm.field.systemPrompt") }}</span>
                <textarea
                  v-model="settings.state.llm.systemPrompt"
                  class="textarea"
                  rows="4"
                  spellcheck="false"
                  :placeholder="t('settings.llm.field.systemPromptPlaceholder')"
                />
                <span class="field-hint">
                  {{ t("settings.llm.field.systemPromptHint") }}
                </span>
              </label>
            </div>

            <div class="protocol card">
              <p class="section-label">{{ t("settings.llm.protocol.title") }}</p>
              <ul class="protocol-list">
                <li>{{ t("settings.llm.protocol.body") }}</li>
                <li>{{ t("settings.llm.protocol.downgrade") }}</li>
                <li>{{ t("settings.llm.protocol.reasoning") }}</li>
                <li>{{ t("settings.llm.protocol.multimodal") }}</li>
                <li>{{ t("settings.llm.protocol.auth") }}</li>
              </ul>
            </div>
          </section>

          <!-- ============================================ 通用 -->
          <section v-show="tab === 'general'" class="sec">
            <div class="card card-pad">
              <header class="sec-head">
                <div>
                  <h2 class="sec-title">{{ t("settings.general.title") }}</h2>
                  <p class="sec-sub">{{ t("settings.general.sub") }}</p>
                </div>
              </header>

              <div class="form-grid">
                <div class="field">
                  <span class="field-label">{{ t("settings.general.theme") }}</span>
                  <UiSegmented
                    :model-value="settings.state.app.theme"
                    block
                    :options="[
                      { label: t('settings.general.theme.light'), value: 'light', icon: 'sun' },
                      { label: t('settings.general.theme.dark'), value: 'dark', icon: 'moon' },
                    ]"
                    @update:model-value="setTheme"
                  />
                </div>

                <label class="field">
                  <span class="field-label">{{ t("settings.locale.label") }}</span>
                  <!--
                    选项列表是函数不是常量：模块级常量在 import 时求值，
                    那一刻拿到的还是启动时的语言，切到英文后这里仍显示「跟随系统」。
                  -->
                  <select
                    :value="settings.state.app.locale"
                    class="select"
                    @change="setLocale(($event.target as HTMLSelectElement).value as AppSettings['locale'])"
                  >
                    <option v-for="option in localeOptions()" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </option>
                  </select>
                </label>

                <label class="field">
                  <span class="field-label">{{ t("settings.general.defaultSize") }}</span>
                  <select v-model="settings.state.app.defaultSize" class="select">
                    <option v-for="option in aspectOptions()" :key="option.size" :value="option.size">
                      {{ option.hint }}
                    </option>
                  </select>
                </label>

                <div class="field">
                  <span class="field-label">{{ t("settings.general.defaultCount") }}</span>
                  <UiNumber
                    :model-value="settings.state.app.defaultCount"
                    :min="1"
                    :max="10"
                    :suffix="t('settings.unit.images')"
                    @update:model-value="settings.state.app.defaultCount = $event"
                  />
                </div>

                <label class="field">
                  <span class="field-label">{{ t("settings.general.defaultStyle") }}</span>
                  <select v-model="settings.state.app.defaultStyle" class="select">
                    <option v-for="option in styleOptions" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </option>
                  </select>
                </label>

                <div class="field">
                  <span class="field-label">{{ t("settings.general.demoMode") }}</span>
                  <UiSwitch
                    v-model="settings.state.app.demoMode"
                    :label="t('settings.general.demoModeLabel')"
                    :hint="t('settings.general.demoModeHint')"
                  />
                </div>

                <div class="field">
                  <span class="field-label">{{ t("settings.general.history") }}</span>
                  <UiSwitch
                    v-model="settings.state.app.autoSaveHistory"
                    :label="t('settings.general.autoSaveLabel')"
                    :hint="t('settings.general.autoSaveHint')"
                  />
                </div>
              </div>

              <div class="row gap-2" style="margin-top: 16px">
                <button class="btn btn-sm" @click="resetDraft">
                  <UiIcon name="refresh" :size="14" />{{ t("settings.general.resetDraft") }}
                </button>
                <button class="btn btn-sm" @click="settings.toggleTheme()">
                  <UiIcon :name="settings.state.app.theme === 'light' ? 'moon' : 'sun'" :size="14" />{{ t("settings.general.toggleTheme") }}
                </button>
              </div>
            </div>
          </section>

          <!-- ============================================ 预设中心 -->
          <section v-show="tab === 'presets'" class="sec">
            <div class="card card-pad">
              <header class="sec-head">
                <div>
                  <h2 class="sec-title">{{ t("settings.presets.title") }}</h2>
                  <p class="sec-sub">
                    {{ t("settings.presets.sub") }}
                  </p>
                </div>
                <div class="row gap-2">
                  <button class="btn btn-sm" @click="restoreStyles">
                    <UiIcon name="refresh" :size="14" />{{ t("settings.presets.restore") }}
                  </button>
                  <button class="btn btn-sm btn-primary" @click="addStylePreset">
                    <UiIcon name="plus" :size="14" />{{ t("settings.presets.add") }}
                  </button>
                </div>
              </header>

              <div class="preset-list">
                <article v-for="item in presets.styles" :key="item.id" class="preset-card">
                  <div class="preset-row">
                    <input
                      class="input preset-label"
                      :placeholder="t('settings.presets.labelPlaceholder')"
                      :value="item.label"
                      @input="presets.updateStyle(item.id, { label: ($event.target as HTMLInputElement).value })"
                    />
                    <span v-if="item.builtin" class="tag">{{ t("settings.presets.builtin") }}</span>
                    <button class="icon-btn" :title="t('settings.presets.deleteTitle')" @click="removeStylePreset(item)">
                      <UiIcon name="trash" :size="15" />
                    </button>
                  </div>
                  <textarea
                    class="textarea preset-value"
                    :placeholder="t('settings.presets.valuePlaceholder')"
                    :value="item.value"
                    @input="presets.updateStyle(item.id, { value: ($event.target as HTMLTextAreaElement).value })"
                  />
                  <input
                    class="input"
                    :placeholder="t('settings.presets.negativePlaceholder')"
                    :value="item.negative"
                    @input="presets.updateStyle(item.id, { negative: ($event.target as HTMLInputElement).value })"
                  />
                </article>
                <p v-if="!presets.styles.length" class="field-hint">
                  {{ t("settings.presets.empty") }}
                </p>
              </div>
            </div>
          </section>

          <!-- ============================================ 调试与日志 -->
          <section v-show="tab === 'debug'" class="sec">
            <div class="card card-pad">
              <header class="sec-head">
                <div>
                  <h2 class="sec-title">{{ t("settings.debug.title") }}</h2>
                  <p class="sec-sub">
                    {{ t("settings.debug.sub") }}
                  </p>
                </div>
                <div class="row gap-2">
                  <span v-if="debugLog.errorCount" class="tag tag-danger">{{ t("settings.debug.errorCount", { count: debugLog.errorCount }) }}</span>
                  <button class="btn btn-sm btn-primary" @click="ui.openDebugDrawer()">
                    <UiIcon name="bug" :size="14" />{{ t("settings.debug.viewLog") }}
                  </button>
                </div>
              </header>

              <p v-if="settings.persistError" class="persist-warn">
                <UiIcon name="alert" :size="13" />{{ t("settings.debug.persistError", { error: settings.persistError }) }}
              </p>

              <div class="form-grid">
                <div class="field">
                  <span class="field-label">{{ t("settings.debug.field.enabled") }}</span>
                  <UiSwitch
                    :model-value="settings.state.debug.enabled"
                    :label="t('settings.debug.field.enabledLabel')"
                    :hint="t('settings.debug.field.enabledHint')"
                    @update:model-value="(v) => setDebug({ enabled: v })"
                  />
                  <span class="debug-state" :class="settings.state.debug.enabled ? 'is-ok' : 'is-off'">
                    <UiIcon :name="settings.state.debug.enabled ? 'check' : 'info'" :size="12" />
                    {{
                      settings.state.debug.enabled
                        ? debugLog.platformEnabled
                          ? t("settings.debug.state.on")
                          : t("settings.debug.state.notSynced")
                        : t("settings.debug.state.off")
                    }}
                  </span>
                </div>

                <div class="field">
                  <span class="field-label">{{ t("settings.debug.field.body") }}</span>
                  <UiSwitch
                    :model-value="settings.state.debug.captureBody"
                    :label="t('settings.debug.field.bodyLabel')"
                    :hint="settings.state.debug.enabled ? t('settings.debug.field.bodyHint') : t('settings.debug.needEnabled')"
                    @update:model-value="(v) => setDebug({ captureBody: v })"
                  />
                </div>

                <div class="field">
                  <span class="field-label">{{ t("settings.debug.field.headers") }}</span>
                  <UiSwitch
                    :model-value="settings.state.debug.captureHeaders"
                    :label="t('settings.debug.field.headersLabel')"
                    :hint="settings.state.debug.enabled ? t('settings.debug.field.headersHint') : t('settings.debug.needEnabled')"
                    @update:model-value="(v) => setDebug({ captureHeaders: v })"
                  />
                </div>

                <label class="field">
                  <span class="field-label">{{ t("settings.debug.field.maxEntries") }}</span>
                  <input
                    class="input"
                    type="number"
                    min="20"
                    max="500"
                    :value="settings.state.debug.maxEntries"
                    @input="settings.state.debug.maxEntries = numFrom($event)"
                  />
                  <span class="field-hint">{{ t("settings.debug.field.maxEntriesHint") }}</span>
                </label>
              </div>

              <div v-if="debugLog.lastError" class="last-error">
                <p class="section-label">{{ t("settings.debug.lastError") }}</p>
                <div class="row gap-2 last-error-row">
                  <span class="tag tag-danger">{{ debugLog.lastError.status || t("settings.debug.networkTag") }}</span>
                  <span class="t-mono t-ellipsis grow">{{ debugLog.lastError.url }}</span>
                  <span class="t-xs t-3rd">{{ debugLog.lastError.durationMs }} ms</span>
                </div>
                <p v-if="debugLog.lastError.hint" class="field-hint">{{ debugLog.lastError.hint }}</p>
              </div>

              <p class="field-hint" style="margin-top: 12px">
                {{ t("settings.debug.storageNote") }}
              </p>
            </div>
          </section>

          <!-- ============================================ 本地超分 -->
          <section v-show="tab === 'upscale'" class="sec">
            <UpscalePanel />
          </section>

          <!-- ============================================ MCP 服务 -->
          <section v-show="tab === 'mcp'" class="sec">
            <McpServicePanel />
          </section>

          <!-- ============================================ 本地数据 -->
          <section v-show="tab === 'data'" class="sec">
            <div class="card card-pad">
              <header class="sec-head">
                <div>
                  <h2 class="sec-title">{{ t("settings.data.title") }}</h2>
                  <p class="sec-sub">{{ t("settings.data.sub") }}</p>
                </div>
                <div class="row gap-2">
                  <button class="btn btn-sm" :disabled="probing" @click="runStorageProbe">
                    <UiIcon :name="probing ? 'loader' : 'check'" :size="14" :class="{ spin: probing }" />
                    {{ t("settings.data.probe") }}
                  </button>
                  <button class="btn btn-sm" :disabled="sweeping" @click="runSweepOrphans">
                    <UiIcon :name="sweeping ? 'loader' : 'trash'" :size="14" :class="{ spin: sweeping }" />
                    {{ t("settings.data.sweep") }}
                  </button>
                  <button class="btn btn-sm" @click="openDataDir">
                    <UiIcon name="folder-open" :size="14" />{{ t("settings.data.openDir") }}
                  </button>
                </div>
              </header>

              <dl class="kv">
                <dt>{{ t("settings.data.kv.dir") }}</dt>
                <dd class="t-mono">{{ dirHint }}</dd>
                <dt>{{ t("settings.data.kv.history") }}</dt>
                <dd>{{ t("settings.data.kv.historyValue", { count: history.stats.total, images: history.stats.images }) }}</dd>
                <dt>{{ t("settings.data.kv.prompts") }}</dt>
                <dd>{{ t("settings.data.kv.promptsValue", { count: prompts.items.length }) }}</dd>
                <dt>{{ t("settings.data.kv.modelChannels") }}</dt>
                <dd>
                  {{ t("settings.data.kv.modelChannelsValue", { count: settings.state.modelApi.channels.length, enabled: settings.enabledModelChannels.length }) }}
                </dd>
                <dt>{{ t("settings.data.kv.workflowChannels") }}</dt>
                <dd>
                  {{ t("settings.data.kv.workflowChannelsValue", { count: settings.state.workflowApi.channels.length, enabled: settings.enabledWorkflowChannels.length, presets: presetTotal }) }}
                </dd>
              </dl>

              <p class="field-hint" style="margin-top: 10px">
                {{ t("settings.data.imageNote") }}
              </p>

              <div v-if="probeResult" class="probe-result" :class="probeResult.ok ? 'is-ok' : 'is-bad'">
                <UiIcon :name="probeResult.ok ? 'check' : 'alert'" :size="14" />
                <span class="grow">
                  {{ probeResult.message }}
                  <span class="t-xs" style="display: block; opacity: 0.8">{{ probeResult.location }}</span>
                </span>
              </div>
            </div>

            <div class="card card-pad danger-zone" style="margin-top: 16px">
              <h2 class="sec-title">{{ t("settings.data.dangerTitle") }}</h2>
              <p class="sec-sub">
                {{ t("settings.data.dangerSub") }}
              </p>
              <button class="btn btn-sm btn-danger" @click="clearAllData">
                <UiIcon name="trash" :size="14" />{{ t("settings.data.clearAll") }}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: 244px minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}
.side {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
}
.side-group {
  padding: 10px 10px 4px;
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.side-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border: 0;
  border-radius: var(--r-md);
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background var(--dur) var(--ease);
}
.side-item:hover {
  background: var(--bg-hover);
}
.side-item.is-active {
  background: var(--accent-soft);
}
.side-icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: var(--r-sm);
  background: var(--bg-muted);
  color: var(--text-secondary);
}
.side-item.is-active .side-icon {
  background: var(--bg-surface);
  color: var(--accent);
}
.side-label {
  display: block;
  font-size: var(--fs-13);
  font-weight: 600;
}
.side-desc {
  display: block;
  font-size: 10.5px;
  color: var(--text-tertiary);
}

.content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.sec {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.intro {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.sec-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}
.sec-title {
  font-size: var(--fs-16);
  font-weight: 680;
  letter-spacing: -0.015em;
}
.sec-sub {
  margin-top: 4px;
  font-size: var(--fs-12);
  color: var(--text-tertiary);
  line-height: 1.6;
}
.sec-sub code,
.protocol-list code {
  padding: 1px 5px;
  border-radius: var(--r-xs);
  background: var(--bg-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
}

/* -------------------------------------------------- 渠道卡片 */

.channel-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.channel {
  overflow: hidden;
  transition: border-color var(--dur) var(--ease), opacity var(--dur) var(--ease);
}
.channel.is-off {
  opacity: 0.72;
}
.channel.is-current {
  border-color: var(--accent);
}
.channel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--bg-subtle);
  border-bottom: 1px solid var(--border);
}
.channel.is-off .channel-head {
  background: var(--bg-muted);
}
.channel-caret {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  flex: none;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
}
.channel-caret:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.channel-icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  flex: none;
  border-radius: var(--r-sm);
  background: var(--brand-grad-soft);
  color: var(--accent-soft-fg);
}
.channel-name {
  width: 172px;
  flex: none;
  height: 28px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  background: transparent;
  font-size: var(--fs-13);
  font-weight: 650;
}
.channel-name:hover {
  border-color: var(--border);
  background: var(--bg-surface);
}
.channel-name:focus {
  outline: none;
  border-color: var(--accent);
  background: var(--bg-surface);
}
.channel-summary {
  padding: 10px 16px;
}
.channel-body {
  padding: 16px;
}
.channel-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px dashed var(--border);
}
.danger-zone {
  border-color: var(--danger);
  background: var(--danger-soft);
}
.danger-zone .sec-title {
  color: var(--danger);
}
.danger-zone .btn-danger {
  margin-top: 14px;
}

/* -------------------------------------------------- 表单 */

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}
.form-grid.is-compact {
  gap: 14px;
}
.span-2 {
  grid-column: span 2;
}
.req {
  color: var(--danger);
  margin-left: 2px;
}

/* -------------------------------------------------- 预设中心 */

.preset-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.preset-card {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 13px 14px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-subtle);
}
.preset-row {
  display: flex;
  align-items: center;
  gap: 9px;
}
.preset-label {
  flex: 1;
  min-width: 0;
  font-weight: 600;
}
.preset-value {
  min-height: 56px;
  font-family: var(--font-mono);
  font-size: var(--fs-12);
  line-height: 1.6;
}

.empty-preset {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 34px 20px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--r-md);
  text-align: center;
}

.preset-block {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
.preset-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 12px;
}
.preset {
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-subtle);
}
.preset-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
.preset-icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  flex: none;
  border-radius: var(--r-sm);
  background: var(--brand-grad-soft);
  color: var(--accent-soft-fg);
}
.preset-name-input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  background: transparent;
  font-size: var(--fs-14);
  font-weight: 650;
}
.preset-name-input:hover {
  border-color: var(--border);
  background: var(--bg-surface);
}
.preset-name-input:focus {
  outline: none;
  border-color: var(--accent);
  background: var(--bg-surface);
}

.input-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.input-row {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr) 88px 26px;
  align-items: center;
  gap: 8px;
}
.input-role {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: var(--fs-12);
  color: var(--text-secondary);
}
/* 字段名：窄、等宽，一眼能看出它和节点 ID 是一对 */
.input-row .field-name {
  padding-inline: 8px;
  font-family: var(--font-mono);
  font-size: var(--fs-11);
  color: var(--text-secondary);
}
.add-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--border);
}

.analysis {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px dashed var(--border);
}
.analysis-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 8px;
  max-height: 320px;
  overflow-y: auto;
}
.analysis-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bg-surface);
  font-size: var(--fs-12);
}
.analysis-row:hover {
  border-color: var(--border-strong);
}
.analysis-id {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-tertiary);
  flex: none;
  width: 40px;
}
.analysis-title {
  flex: 1;
  min-width: 0;
  color: var(--text);
}
.analysis-type {
  flex: none;
  max-width: 190px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-faint);
}
/* 固定宽度，让每个节点的角色标签与右侧芯片各自对齐成一列 */
.analysis-role {
  flex: none;
  width: 88px;
  display: flex;
  justify-content: flex-end;
}
.role-chips {
  display: flex;
  flex: none;
  gap: 4px;
}
.role-chip {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  background: var(--bg-subtle);
  color: var(--text-faint);
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.role-chip:hover {
  border-color: var(--accent);
  color: var(--accent);
}
/* 识别建议：虚线描边，提示「多半该填这里」 */
.role-chip.is-suggested {
  border-style: dashed;
  border-color: var(--accent);
  color: var(--accent);
}
/* 已生效的映射：实心高亮，保证点下去一定能看见变化 */
.role-chip.is-active {
  border-style: solid;
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-fg);
  font-weight: 700;
}
/* 手动添加槽位用的短标签：比识别建议更弱，避免和「已生效」混淆 */
.role-chip.is-add {
  border-style: dashed;
  color: var(--text-tertiary);
}
.role-chip.is-add:hover {
  border-color: var(--accent);
  border-style: solid;
  color: var(--accent);
}

.preset-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.protocol {
  margin-top: 16px;
  padding: 14px 16px;
  background: var(--bg-subtle);
}
.last-error {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 16px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-subtle);
}
.persist-warn {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin-bottom: 16px;
  padding: 10px 12px;
  border-radius: var(--r-md);
  background: var(--danger-soft);
  color: var(--danger);
  font-size: var(--fs-12);
  line-height: 1.55;
  word-break: break-word;
}
.debug-state {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--fs-11);
  line-height: 1.5;
}
.debug-state.is-ok {
  color: var(--success);
}
.debug-state.is-off {
  color: var(--text-faint);
}
.probe-result {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: var(--r-md);
  font-size: var(--fs-12);
  line-height: 1.55;
  word-break: break-word;
}
.probe-result.is-ok {
  background: var(--success-soft);
  color: var(--success);
}
.probe-result.is-bad {
  background: var(--danger-soft);
  color: var(--danger);
}
.last-error-row {
  min-width: 0;
  font-size: var(--fs-11);
  color: var(--text-secondary);
}
/* 协议要点里混着大量 API 标识符（model / stream:false / reasoning_content…）。
   这些段落整体走等宽字体：原先是对 <code> 单独上色，但词条化之后
   标识符已经融进整句译文里，逐词拆 <code> 会让词条碎成十几段、
   且中英语序不同根本对不上，所以改成整段等宽，既保住可读性也不牺牲译文。 */
.protocol-list {
  margin: 8px 0 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: var(--fs-12);
  color: var(--text-secondary);
  line-height: 1.6;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
}

@media (max-width: 1200px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .side {
    position: static;
    flex-direction: row;
    overflow-x: auto;
  }
  .side-group {
    display: none;
  }
  .form-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .span-2 {
    grid-column: span 1;
  }
}
</style>

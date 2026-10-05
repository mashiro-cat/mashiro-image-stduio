<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import type { GeneratedImage, WorkflowInput, WorkflowNodeRole, WorkflowPreset } from "../types";
import { NODE_ROLE_META } from "../types";
import { useDraftStore, workflowFieldKey } from "../stores/draft";
import { useSettingsStore } from "../stores/settings";
import { useUiStore } from "../stores/ui";
import { useGenerator } from "../composables/useGenerator";
import { useWorkbenchActions } from "../composables/useWorkbenchActions";
import { downloadImage } from "../platform/media";
import { copyText, formatDuration } from "../platform/env";
import { nodeRoleLabel, t } from "../i18n";
import UiIcon from "../components/ui/UiIcon.vue";
import PreviewStage from "../components/workbench/PreviewStage.vue";
import WorkflowImageSlot from "../components/workbench/WorkflowImageSlot.vue";
import EnhanceResult from "../components/workbench/EnhanceResult.vue";

// 这个名字同时是 App.vue 里 KeepAlive include 的匹配依据，改名要一起改
defineOptions({ name: "WorkflowView" });

const router = useRouter();
const draft = useDraftStore();
const settings = useSettingsStore();
const ui = useUiStore();

const { images, activeIndex, status, progressText, elapsed, busy, runWorkflow, reset, cancel, appendUpscaled } =
  useGenerator();
const {
  enhancing,
  importing,
  enhanceResult,
  enhanceApplied,
  enhanceOriginal,
  pickOneImage,
  importImages,
  enhance,
  applyEnhance,
  discardEnhance,
  savePromptToLibrary,
} = useWorkbenchActions();

const preset = computed(() => settings.activePreset);
const presetId = computed(() => preset.value?.id ?? "");

/** 只展示真正填了节点 ID 的槽位 */
const inputs = computed<WorkflowInput[]>(() =>
  (preset.value?.nodes.inputs ?? []).filter((input) => input.nodeId.trim()),
);

/** 角色 → 该角色第一个槽位：只有它和大模型生图共用同一份草稿（提示词/种子/步数） */
const primaryIds = computed(() => {
  const map: Partial<Record<WorkflowNodeRole, string>> = {};
  for (const input of inputs.value) if (!map[input.role]) map[input.role] = input.id;
  return map;
});
const isPrimary = (input: WorkflowInput) => primaryIds.value[input.role] === input.id;

/**
 * 槽位标题的展示名。
 *
 * `input.label` 是 relabelInputs() 写好的数据（「输入图片」/「输入图片 2」），
 * 直接显示它等于把中文钉死。取 nodeRoleLabel(role) 走词条，再把持久化在末尾的
 * 序号接回去——既按当前语言显示，又不把译名写回用户配置。
 */
function slotLabel(input: WorkflowInput) {
  const suffix = input.label.match(/(\d+)\s*$/)?.[1];
  const base = nodeRoleLabel(input.role);
  return suffix && suffix !== "1" ? `${base} ${suffix}` : base;
}

function slotValue(input: WorkflowInput): string {
  if (!isPrimary(input)) return draft.draft.workflowValues[workflowFieldKey(presetId.value, input.id)] ?? "";
  if (input.role === "positive") return draft.draft.prompt;
  if (input.role === "negative") return draft.draft.negative;
  if (input.role === "seed") return draft.draft.seed === null ? "" : String(draft.draft.seed);
  if (input.role === "steps") return draft.draft.steps === null ? "" : String(draft.draft.steps);
  return "";
}

function setSlotValue(input: WorkflowInput, raw: string) {
  if (!isPrimary(input)) {
    draft.setWorkflowValue(presetId.value, input.id, raw);
    return;
  }
  if (input.role === "positive") draft.patch({ prompt: raw });
  else if (input.role === "negative") draft.patch({ negative: raw });
  else if (input.role === "seed") draft.patch({ seed: raw.trim() === "" ? null : Number(raw) });
  else if (input.role === "steps") draft.patch({ steps: raw.trim() === "" ? null : Number(raw) });
  else draft.setWorkflowValue(presetId.value, input.id, raw);
}

function imageOf(input: WorkflowInput): GeneratedImage | null {
  return draft.draft.workflowImages[workflowFieldKey(presetId.value, input.id)] ?? null;
}

async function pickImage(input: WorkflowInput) {
  const image = await pickOneImage();
  if (image) draft.setWorkflowImage(presetId.value, input.id, image);
}

async function dropImage(input: WorkflowInput, files: File[]) {
  const imported = await importImages(files);
  if (imported[0]) draft.setWorkflowImage(presetId.value, input.id, imported[0]);
}

function randomizeSeed(input: WorkflowInput) {
  setSlotValue(input, String(Math.floor(Math.random() * 2 ** 31)));
}

const primaryPrompt = computed(() => {
  const input = inputs.value.find((item) => item.role === "positive");
  return input ? slotValue(input) : "";
});
const primaryNegative = computed(() => {
  const input = inputs.value.find((item) => item.role === "negative");
  return input ? slotValue(input) : "";
});

/* ------------------------------------------------------------ 工作流选择器 */

const pickerOpen = ref(false);
const keyword = ref("");
const pickerRef = ref<HTMLElement | null>(null);

const channelOptions = computed(() =>
  settings.enabledWorkflowChannels.map((channel) => ({
    label: t("workflow.preset.channelCount", { name: channel.name, count: channel.presets.length }),
    value: channel.id,
  })),
);
const currentChannelId = computed({
  get: () => settings.activeWorkflowChannel?.id ?? "",
  set: (value: string) => settings.selectWorkflowChannel(value),
});

const filteredPresets = computed(() => {
  const list = settings.workflowPresets;
  const word = keyword.value.trim().toLowerCase();
  if (!word) return list;
  return list.filter(
    (item) => item.name.toLowerCase().includes(word) || item.workflowId.toLowerCase().includes(word),
  );
});

function inputCount(item: WorkflowPreset) {
  return item.nodes.inputs.filter((input) => input.nodeId.trim()).length;
}

/** 实例类型 default / plus / ultra 是数据，这里只展示显存规格 */
const INSTANCE_KEYS: Record<WorkflowPreset["instanceType"], string> = {
  default: "workflow.preset.instance.default",
  plus: "workflow.preset.instance.plus",
  ultra: "workflow.preset.instance.ultra",
};

function instanceLabel(value: WorkflowPreset["instanceType"]) {
  return t(INSTANCE_KEYS[value] ?? INSTANCE_KEYS.default);
}

function togglePicker() {
  pickerOpen.value = !pickerOpen.value;
  if (pickerOpen.value) keyword.value = "";
}

function selectPreset(item: WorkflowPreset) {
  settings.activePresetId = item.id;
  pickerOpen.value = false;
}

function onDocumentPointerDown(event: PointerEvent) {
  if (!pickerOpen.value) return;
  const target = event.target as Node | null;
  if (target && pickerRef.value && !pickerRef.value.contains(target)) pickerOpen.value = false;
}

const canRun = computed(() => Boolean(preset.value?.workflowId) && inputs.value.length > 0);

/* ------------------------------------------------------------ 提交 */

async function submit() {
  const current = preset.value;
  if (!current) {
    ui.error(t("workflow.run.noPreset.title"), t("workflow.run.noPreset.desc"));
    return;
  }
  if (!settings.hasWorkflowApi) {
    ui.error(t("workflow.run.notReady.title"), t("workflow.run.notReady.desc"));
    return;
  }

  const texts: Record<string, string> = {};
  const numbers: Record<string, number> = {};
  const imageMap: Record<string, GeneratedImage | null> = {};
  for (const input of inputs.value) {
    if (input.role === "image") {
      imageMap[input.id] = imageOf(input);
      continue;
    }
    const raw = slotValue(input).trim();
    if (!raw) continue;
    if (input.role === "seed" || input.role === "steps") {
      const value = Number(raw);
      if (Number.isFinite(value)) numbers[input.id] = value;
    } else {
      texts[input.id] = raw;
    }
  }

  await runWorkflow({ preset: current, texts, numbers, images: imageMap });
}

async function onDownload(image: GeneratedImage) {
  const saved = await downloadImage(image, `mashiro_workflow_${image.id}.png`);
  if (saved) ui.success(t("workflow.toast.imageSaved"), saved);
  else ui.error(t("workflow.toast.saveFailed.title"), t("workflow.toast.saveFailed.desc"));
}

async function copyTaskId() {
  const ok = await copyText(lastTaskId.value);
  if (ok) ui.success(t("workflow.toast.taskIdCopied"));
}

const lastTaskId = computed(() => progressText.value.match(/(\d{6,})/)?.[1] ?? "");

/** 状态枚举保持原样，展示名走词条查表 */
const STATUS_KEYS: Record<string, string> = {
  idle: "workflow.status.idle",
  queued: "workflow.status.queued",
  running: "workflow.status.running",
  success: "workflow.status.success",
  failed: "workflow.status.failed",
  canceled: "workflow.status.canceled",
};
const statusLabel = computed(() => t(STATUS_KEYS[status.value] ?? STATUS_KEYS.idle));
const runTarget = computed(() => {
  const channel = settings.activeWorkflowChannel;
  if (!channel || !preset.value) return "";
  return `${channel.name} · ${preset.value.name}`;
});

function onKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    if (!busy.value) void submit();
  }
}

/**
 * 监听只在页面可见时挂着：保活（KeepAlive）后离开页面只会触发 onDeactivated，
 * 不摘掉的话在别的页面按 Ctrl+Enter 也会开始生成。
 */
function bindGlobalListeners() {
  window.addEventListener("keydown", onKeydown);
  document.addEventListener("pointerdown", onDocumentPointerDown, true);
}
function unbindGlobalListeners() {
  window.removeEventListener("keydown", onKeydown);
  document.removeEventListener("pointerdown", onDocumentPointerDown, true);
}

onMounted(bindGlobalListeners);
onActivated(bindGlobalListeners);
onDeactivated(unbindGlobalListeners);
onBeforeUnmount(unbindGlobalListeners);
</script>

<template>
  <div class="wk">
    <!-- ==================================== 顶部：选工作流 + 运行 -->
    <header class="wk-bar card">
      <span class="bar-title">
        <span class="bar-icon"><UiIcon name="workflow" :size="16" /></span>
        <span class="col">
          <span class="t-sm strong">{{ t("workflow.title") }}</span>
          <span class="t-xs t-faint t-ellipsis">{{ runTarget || t("workflow.noPresetSelected") }}</span>
        </span>
      </span>

      <select v-if="channelOptions.length > 1" v-model="currentChannelId" class="select bar-select">
        <option v-for="option in channelOptions" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>

      <!-- 工作流选择器 -->
      <div ref="pickerRef" class="picker">
        <button class="picker-trigger" :class="{ 'is-open': pickerOpen }" @click="togglePicker">
          <UiIcon name="layers" :size="14" />
          <span class="picker-name t-ellipsis">{{ preset?.name ?? t("workflow.preset.select") }}</span>
          <span v-if="preset" class="tag">{{ t("workflow.preset.inputCount", { count: inputs.length }) }}</span>
          <UiIcon :name="pickerOpen ? 'chevron-up' : 'chevron-down'" :size="14" />
        </button>

        <div v-if="pickerOpen" class="picker-menu">
          <div class="picker-search">
            <UiIcon name="search" :size="13" />
            <input v-model="keyword" class="picker-input" :placeholder="t('workflow.preset.searchPlaceholder')" spellcheck="false" />
          </div>
          <div class="picker-list">
            <button
              v-for="item in filteredPresets"
              :key="item.id"
              class="picker-item"
              :class="{ 'is-active': settings.activePresetId === item.id }"
              @click="selectPreset(item)"
            >
              <span class="picker-item-icon"><UiIcon name="workflow" :size="14" /></span>
              <span class="grow" style="min-width: 0">
                <span class="picker-item-name t-ellipsis">{{ item.name }}</span>
                <span class="picker-item-sub t-ellipsis">
                  {{
                    item.workflowId
                      ? t("workflow.preset.idLine", { id: item.workflowId, count: inputCount(item) })
                      : `${t("workflow.preset.idMissing")} · ${t("workflow.preset.inputCount", { count: inputCount(item) })}`
                  }}
                </span>
              </span>
              <span class="tag">{{ instanceLabel(item.instanceType) }}</span>
              <UiIcon v-if="settings.activePresetId === item.id" name="check" :size="14" />
            </button>
            <p v-if="!filteredPresets.length" class="picker-empty">
              {{
                settings.workflowPresets.length ? t("workflow.preset.noMatch") : t("workflow.preset.empty")
              }}
            </p>
          </div>
          <footer class="picker-foot">
            <button class="link-btn" @click="router.push('/settings?tab=workflow')">
              <UiIcon name="plus" :size="13" />{{ t("workflow.preset.manage") }}
            </button>
          </footer>
        </div>
      </div>

      <span class="grow" />

      <span v-if="elapsed" class="t-xs t-3rd">{{ formatDuration(elapsed) }}</span>
      <button v-if="busy" class="btn btn-sm" @click="cancel()">
        <UiIcon name="stop" :size="13" />{{ t("workflow.run.cancel") }}
      </button>
      <button class="btn btn-primary btn-sm" :disabled="busy || !canRun" @click="submit">
        <UiIcon :name="busy ? 'loader' : 'play'" :size="14" :class="{ spin: busy }" />
        {{ busy ? t("workflow.run.running") : t("workflow.run.start") }}
      </button>
    </header>

    <div class="wk-body">
      <!-- ==================================== 左：工作流自己的输入 -->
      <aside class="wk-side card scroll-y">
        <div class="side-body">
          <template v-if="!settings.hasWorkflowApi">
            <div class="empty">
              <span class="empty-icon"><UiIcon name="key" :size="20" /></span>
              <p class="t-md t-2nd">{{ t("workflow.empty.noChannel.title") }}</p>
              <p class="t-xs t-3rd">{{ t("workflow.empty.noChannel.desc") }}</p>
              <button class="btn btn-primary btn-sm" @click="router.push('/settings?tab=workflow')">
                <UiIcon name="key" :size="14" />{{ t("workflow.empty.noChannel.action") }}
              </button>
            </div>
          </template>

          <template v-else-if="!preset">
            <div class="empty">
              <span class="empty-icon"><UiIcon name="workflow" :size="20" /></span>
              <p class="t-md t-2nd">{{ t("workflow.empty.noPreset.title") }}</p>
              <p class="t-xs t-3rd">{{ t("workflow.empty.noPreset.desc") }}</p>
              <button class="btn btn-primary btn-sm" @click="router.push('/settings?tab=workflow')">
                <UiIcon name="plus" :size="14" />{{ t("workflow.empty.noPreset.action") }}
              </button>
            </div>
          </template>

          <template v-else-if="!inputs.length">
            <div class="empty">
              <span class="empty-icon"><UiIcon name="alert" :size="20" /></span>
              <p class="t-md t-2nd">{{ t("workflow.empty.noSlots.title", { name: preset.name }) }}</p>
              <p class="t-xs t-3rd">
                {{ t("workflow.empty.noSlots.desc") }}
              </p>
              <button class="btn btn-sm" @click="router.push('/settings?tab=workflow')">
                <UiIcon name="settings" :size="14" />{{ t("workflow.empty.noSlots.action") }}
              </button>
            </div>
          </template>

          <template v-else>
            <section v-for="input in inputs" :key="input.id" class="slot">
              <header class="slot-head">
                <span class="slot-badge"><UiIcon :name="NODE_ROLE_META[input.role].icon" :size="13" /></span>
                <span class="slot-name">{{ slotLabel(input) }}</span>
                <span class="slot-node t-ellipsis">
                  {{ t("workflow.input.nodeBadge", { node: input.nodeId, field: input.fieldName }) }}
                </span>
                <span class="grow" />
                <!-- 增强只服务与工作台共用的那一份提示词，第二个及以后的正向槽位不挂这些动作 -->
                <template v-if="input.role === 'positive' && isPrimary(input)">
                  <button
                    class="icon-btn"
                    :title="t('workflow.input.enhance')"
                    :disabled="enhancing || (!settings.hasLlm && !settings.useDemo)"
                    @click="enhance()"
                  >
                    <UiIcon :name="enhancing ? 'loader' : 'sparkles'" :size="15" :class="{ spin: enhancing }" />
                  </button>
                  <button class="icon-btn" :title="t('workflow.input.saveToLibrary')" @click="savePromptToLibrary()">
                    <UiIcon name="bookmark" :size="15" />
                  </button>
                </template>
                <button
                  v-if="slotValue(input)"
                  class="icon-btn"
                  :title="t('workflow.input.clear')"
                  @click="setSlotValue(input, '')"
                >
                  <UiIcon name="trash" :size="15" />
                </button>
              </header>

              <textarea
                v-if="input.role === 'positive' || input.role === 'negative'"
                class="textarea slot-text"
                :placeholder="
                  input.role === 'positive'
                    ? t('workflow.input.positivePlaceholder')
                    : t('workflow.input.negativePlaceholder')
                "
                :value="slotValue(input)"
                @input="setSlotValue(input, ($event.target as HTMLTextAreaElement).value)"
              />

              <WorkflowImageSlot
                v-else-if="input.role === 'image'"
                :image="imageOf(input)"
                :loading="importing"
                @pick="pickImage(input)"
                @drop="(files) => dropImage(input, files)"
                @remove="draft.setWorkflowImage(presetId, input.id, null)"
              />

              <div v-else class="row gap-2">
                <input
                  class="input"
                  type="number"
                  :placeholder="t('workflow.input.numberPlaceholder')"
                  :value="slotValue(input)"
                  @input="setSlotValue(input, ($event.target as HTMLInputElement).value)"
                />
                <button
                  v-if="input.role === 'seed'"
                  class="btn btn-sm"
                  :title="t('workflow.input.randomSeed')"
                  @click="randomizeSeed(input)"
                >
                  <UiIcon name="refresh" :size="13" />
                </button>
              </div>

              <!-- 增强结果与大模型生图共用同一套展示：完整给出对比与拆解，再让用户决定是否采纳 -->
              <EnhanceResult
                v-if="input.role === 'positive' && isPrimary(input) && enhanceResult"
                class="enhance-result"
                :prompt="enhanceResult.prompt"
                :original="enhanceOriginal"
                :negative="enhanceResult.negative"
                :structured="enhanceResult.structured"
                :notes="enhanceResult.notes"
                :applied="enhanceApplied"
                @apply="applyEnhance()"
                @discard="discardEnhance()"
              />

              <p v-if="input.role === 'positive' && isPrimary(input)" class="field-hint">
                {{ t("workflow.input.sharedWithStudio") }}
              </p>
            </section>
          </template>

          <section v-if="status !== 'idle'" class="slot">
            <header class="slot-head">
              <span class="slot-badge" :class="`is-${status}`"><UiIcon name="cpu" :size="13" /></span>
              <span class="slot-name">{{ statusLabel }}</span>
              <span class="grow" />
              <span class="t-xs t-3rd">{{ formatDuration(elapsed) }}</span>
            </header>
            <p class="task-text">{{ progressText || t("workflow.run.queued") }}</p>
            <button v-if="lastTaskId" class="link-btn" :title="t('workflow.status.copyTaskId')" @click="copyTaskId">
              <UiIcon name="copy" :size="12" />{{ t("workflow.status.taskId", { id: lastTaskId }) }}
            </button>
          </section>
        </div>
      </aside>

      <!-- ==================================== 右：结果 -->
      <PreviewStage
        class="wk-stage"
        :title="t('workflow.resultTitle')"
        :images="images"
        :active-index="activeIndex"
        :status="status"
        :progress-text="progressText"
        :elapsed="elapsed"
        :prompt="primaryPrompt"
        :negative="primaryNegative"
        :structured="null"
        size=""
        :count="images.length || 1"
        :empty-hint="t('workflow.empty.hintFillThenRun')"
        @update:active-index="(v) => (activeIndex = v)"
        @download="onDownload"
        @reuse="submit"
        @clear="reset()"
        @upscaled="(payload) => appendUpscaled(payload.image)"
      />
    </div>
  </div>
</template>

<style scoped>
.wk {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 18px 18px;
  background: var(--bg-app);
}

/* -------------------------------------------------- 顶部条 */
.wk-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
}
.bar-title {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}
.bar-icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: var(--r-sm);
  background: var(--brand-grad-soft);
  color: var(--accent-soft-fg);
}
.strong {
  font-weight: 650;
}
.bar-select {
  max-width: 210px;
}

/* -------------------------------------------------- 选择器 */
.picker {
  position: relative;
  min-width: 0;
}
.picker-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 360px;
  padding: 7px 11px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-surface);
  color: var(--text);
  font-size: var(--fs-13);
  cursor: pointer;
  transition: border-color var(--dur) var(--ease);
}
.picker-trigger:hover,
.picker-trigger.is-open {
  border-color: var(--accent);
}
.picker-name {
  max-width: 200px;
  font-weight: 600;
}
.picker-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 40;
  width: 380px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-surface);
  box-shadow: var(--shadow-md);
  overflow: hidden;
}
.picker-search {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--border);
  color: var(--text-tertiary);
}
.picker-input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text);
  font-size: var(--fs-13);
}
.picker-list {
  max-height: 320px;
  overflow-y: auto;
  padding: 6px;
}
.picker-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 8px 9px;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.picker-item:hover {
  background: var(--bg-hover);
}
.picker-item.is-active {
  background: var(--accent-soft);
}
.picker-item-icon {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  flex: none;
  border-radius: var(--r-xs);
  background: var(--bg-muted);
  color: var(--text-secondary);
}
.picker-item-name {
  display: block;
  font-size: var(--fs-13);
  font-weight: 600;
}
.picker-item-sub {
  display: block;
  font-size: var(--fs-11);
  color: var(--text-tertiary);
}
.picker-empty {
  padding: 18px 10px;
  text-align: center;
  font-size: var(--fs-12);
  color: var(--text-tertiary);
}
.picker-foot {
  padding: 8px 12px;
  border-top: 1px solid var(--border);
  background: var(--bg-subtle);
}
.link-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--accent);
  font-size: var(--fs-12);
  cursor: pointer;
}
.link-btn:hover {
  text-decoration: underline;
}

/* -------------------------------------------------- 主体 */
.wk-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 372px minmax(0, 1fr);
  gap: 12px;
}
.wk-side,
.wk-stage {
  min-height: 0;
}
.side-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
}

.slot {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.slot-head {
  display: flex;
  align-items: center;
  gap: 7px;
}
.slot-badge {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  flex: none;
  border-radius: var(--r-xs);
  background: var(--bg-muted);
  color: var(--text-secondary);
}
.slot-badge.is-running,
.slot-badge.is-queued {
  background: var(--warning-soft);
  color: var(--warning);
}
.slot-badge.is-success {
  background: var(--success-soft);
  color: var(--success);
}
.slot-badge.is-failed {
  background: var(--danger-soft);
  color: var(--danger);
}
.slot-name {
  font-size: var(--fs-13);
  font-weight: 620;
}
.slot-node {
  max-width: 130px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-faint);
}
.slot-text {
  min-height: 118px;
}
/* 增强结果：和输入框拉开一点距离，让「结果」与「输入」是两段 */
.enhance-result {
  margin-top: 2px;
  padding-top: 10px;
  border-top: 1px dashed var(--border);
}
.task-text {
  font-size: var(--fs-12);
  color: var(--text-secondary);
  line-height: 1.6;
  word-break: break-word;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  padding: 26px 14px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--r-md);
  text-align: center;
}
.empty-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: var(--r-sm);
  background: var(--bg-muted);
  color: var(--text-tertiary);
}

@media (max-width: 1360px) {
  .wk-body {
    grid-template-columns: 330px minmax(0, 1fr);
  }
}
</style>

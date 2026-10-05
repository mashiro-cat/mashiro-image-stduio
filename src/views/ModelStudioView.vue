<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { GeneratedImage, GenMode } from "../types";
import { useDraftStore } from "../stores/draft";
import { useSettingsStore } from "../stores/settings";
import { useUiStore } from "../stores/ui";
import { useGenerator } from "../composables/useGenerator";
import { useWorkbenchActions } from "../composables/useWorkbenchActions";
import { downloadImage } from "../platform/media";
import { t } from "../i18n";
import UiIcon from "../components/ui/UiIcon.vue";
import UiSegmented from "../components/ui/UiSegmented.vue";
import ModelParamsPanel from "../components/workbench/ModelParamsPanel.vue";
import PreviewStage from "../components/workbench/PreviewStage.vue";
import PromptPanel from "../components/workbench/PromptPanel.vue";
import ReferenceInput from "../components/workbench/ReferenceInput.vue";

// 这个名字同时是 App.vue 里 KeepAlive include 的匹配依据，改名要一起改
defineOptions({ name: "ModelStudioView" });

/** 大模型生图的两种模式：共用同一套模型与上游接口，只是提交方式不同 */
type ModelMode = Extract<GenMode, "text2img" | "img2img">;

const route = useRoute();
const router = useRouter();
const draft = useDraftStore();
const settings = useSettingsStore();
const ui = useUiStore();

const {
  images,
  activeIndex,
  status,
  progressText,
  elapsed,
  busy,
  runModel,
  reset,
  cancel,
  appendUpscaled,
} = useGenerator();
const {
  enhancing,
  importing,
  enhanceResult,
  enhanceKind,
  enhanceApplied,
  enhanceOriginal,
  enhanceImages,
  pickImages,
  addImagesFromFiles,
  enhance,
  reverse,
  applyEnhance,
  discardEnhance,
  savePromptToLibrary,
  composeFinalPrompt,
  composeFinalNegative,
} = useWorkbenchActions();

/** 增强页展示「这次会调用谁」 */
const llmLabel = computed(() => {
  const llm = settings.state.llm;
  if (!llm.model) return "";
  return `${llm.model} · ${llm.disableThinking ? t("studio.llm.thinkingOff") : t("studio.llm.thinkingOn")}`;
});

/** 模式选项里的 label 是文案，切语言时要跟着重算，所以做成 computed 而非常量数组 */
const MODE_OPTIONS = computed(() => [
  { label: t("studio.mode.text2img"), value: "text2img", icon: "sparkles" },
  { label: t("studio.mode.img2img"), value: "img2img", icon: "image-plus" },
]);

/** 模式以 URL 为准，保证「从提示词库/历史记录跳转」能带上目标模式 */
const mode = ref<ModelMode>(route.query.mode === "img2img" ? "img2img" : "text2img");

watch(
  () => route.query.mode,
  (value) => {
    // 侧栏入口是裸 /generate（不带 mode）：此时沿用当前模式，
    // 否则「图生图 → 设置页 → 回来」会被悄悄重置成文生图
    if (value !== "img2img" && value !== "text2img") return;
    if (value !== mode.value) mode.value = value;
  },
);

const isImg2Img = computed(() => mode.value === "img2img");
const modeLabel = computed(() => (isImg2Img.value ? t("studio.mode.img2img") : t("studio.mode.text2img")));

const modeHint = computed(() =>
  isImg2Img.value ? t("studio.mode.hint.img2img") : t("studio.mode.hint.text2img"),
);

const emptyHint = computed(() =>
  isImg2Img.value ? t("studio.preview.empty.hintImg2img") : t("studio.preview.empty.hintText2img"),
);

/** 当前真正参与生图的渠道；没有可用渠道时回退到第一条，便于在演示模式下也能看到模型名 */
const boundChannel = computed(() => settings.activeModelChannel ?? settings.state.modelApi.channels[0]);

/** 模型名归属于当前渠道，切换渠道后模型列表随之变化 */
const model = computed({
  get: () => boundChannel.value?.model ?? "",
  set: (value: string) => {
    const channel = boundChannel.value;
    if (channel) channel.model = value;
  },
});

/** 生图渠道：只能选择「已启用且已填密钥」的渠道 */
const channelOptions = computed(() =>
  settings.enabledModelChannels.map((channel) => ({
    label: `${channel.name} · ${channel.model || t("studio.channel.modelUnset")}`,
    value: channel.id,
  })),
);

const currentChannelId = computed({
  get: () => settings.activeModelChannel?.id ?? "",
  set: (value: string) => settings.selectModelChannel(value),
});

const runTarget = computed(() => {
  const channel = settings.activeModelChannel;
  if (!channel) return "";
  return `${channel.name} · ${channel.model || t("studio.channel.modelUnset")}`;
});

function switchMode(value: string) {
  const next: ModelMode = value === "img2img" ? "img2img" : "text2img";
  if (next === mode.value) return;
  mode.value = next;
  // 只改 query，不重新挂载工作台，避免丢失当前画布结果
  void router.replace({ path: "/generate", query: { mode: next } });
}

async function submit() {
  const prompt = composeFinalPrompt();
  if (!prompt) {
    ui.warning(
      t("studio.toast.promptEmpty.title"),
      isImg2Img.value
        ? t("studio.toast.promptEmpty.descImg2img")
        : t("studio.toast.promptEmpty.descText2img"),
    );
    return;
  }
  if (isImg2Img.value && !draft.draft.references.length) {
    ui.warning(t("studio.toast.noReference.title"), t("studio.toast.noReference.desc"));
    return;
  }

  await runModel({
    mode: mode.value,
    prompt,
    // 风格预设自带的负向词在这里并入，草稿里的原始输入不被改写
    negative: composeFinalNegative(),
    structured: draft.draft.structured,
    styleLabel: draft.draft.style,
    size: draft.draft.size,
    count: draft.draft.count,
    quality: draft.draft.quality,
    references: isImg2Img.value ? draft.draft.references : [],
  });
}

/* 参数预设已移除：模型固定时它只剩「省点点击」，而 size/count/quality
   本来就由 draft 持久化保存，下次打开还在。风格预设保留（改的是提示词内容）。 */

async function onDownload(image: GeneratedImage) {
  const saved = await downloadImage(image, `mashiro_${image.id}.png`);
  if (saved) ui.success(t("studio.toast.imageSaved"), saved);
  else ui.error(t("studio.toast.saveFailed.title"), t("studio.toast.saveFailed.desc"));
}

function onKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    void submit();
  }
}

/**
 * 快捷键只在页面可见时生效。
 * 保活（KeepAlive）后离开页面不会触发 onBeforeUnmount，只触发 onDeactivated——
 * 只在 onMounted 里注册的话，站在设置页按 Ctrl+Enter 会莫名其妙开始生图。
 * 同一个函数引用重复注册会被浏览器忽略，所以两条路径都挂一份即可。
 */
function bindKeydown() {
  window.addEventListener("keydown", onKeydown);
}
function unbindKeydown() {
  window.removeEventListener("keydown", onKeydown);
}

onMounted(bindKeydown);
onActivated(bindKeydown);
onDeactivated(unbindKeydown);
onBeforeUnmount(unbindKeydown);
</script>

<template>
  <div class="studio">
    <header class="studio-bar">
      <UiSegmented :model-value="mode" :options="MODE_OPTIONS" @update:model-value="switchMode" />
      <p class="studio-hint">{{ modeHint }}</p>
      <span class="grow" />
      <span v-if="settings.useDemo" class="tag tag-warning">{{ t("studio.channel.demo") }}</span>
      <template v-if="channelOptions.length">
        <UiIcon name="layers" :size="14" class="t-3rd" />
        <select v-model="currentChannelId" class="select channel-select" :title="t('studio.channel.select')">
          <option v-for="option in channelOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </template>
      <span v-else class="tag tag-warning">{{ t("studio.channel.none") }}</span>
    </header>

    <div class="workbench">
      <aside class="wb-left card scroll-y">
        <ModelParamsPanel
          v-model:model="model"
          :size="draft.draft.size"
          :count="draft.draft.count"
          :quality="draft.draft.quality"
          :style="draft.draft.style"
          :seed="draft.draft.seed"
          :steps="draft.draft.steps"
          :disabled="busy"
          @update:size="(v) => draft.patch({ size: v })"
          @update:count="(v) => draft.patch({ count: v })"
          @update:quality="(v) => draft.patch({ quality: v })"
          @update:style="(v) => draft.patch({ style: v })"
          @update:seed="(v) => draft.patch({ seed: v })"
          @update:steps="(v) => draft.patch({ steps: v })"
        >
          <template v-if="isImg2Img" #extra-top>
            <ReferenceInput
              :images="draft.draft.references"
              :loading="importing"
              @pick="pickImages()"
              @drop="addImagesFromFiles"
              @remove="(id) => draft.removeReference(id)"
              @clear="draft.clearReferences()"
            />
          </template>
        </ModelParamsPanel>
      </aside>

      <PreviewStage
        class="wb-center"
        :title="modeLabel"
        :images="images"
        :active-index="activeIndex"
        :status="status"
        :progress-text="progressText"
        :elapsed="elapsed"
        :prompt="draft.draft.prompt"
        :negative="draft.draft.negative"
        :structured="draft.draft.structured"
        :style-label="draft.draft.style"
        :size="draft.draft.size"
        :count="draft.draft.count"
        :empty-hint="emptyHint"
        @update:active-index="(v) => (activeIndex = v)"
        @download="onDownload"
        @reuse="submit"
        @clear="reset()"
        @upscaled="(payload) => appendUpscaled(payload.image)"
      />

      <PromptPanel
        class="wb-right"
        :prompt="draft.draft.prompt"
        :negative="draft.draft.negative"
        :structured="draft.draft.structured"
        :style-label="draft.draft.style"
        :status="status"
        :enhance-notes="enhanceResult?.notes ?? []"
        :enhance-result-prompt="enhanceResult?.prompt ?? ''"
        :enhance-result-negative="enhanceResult?.negative ?? ''"
        :enhance-applied="enhanceApplied"
        :enhance-original="enhanceOriginal"
        :enhance-images="enhanceImages"
        :reference-count="isImg2Img ? draft.draft.references.length : 0"
        :enhance-structured="enhanceResult?.structured ?? null"
        :enhance-kind="enhanceKind"
        :enhancing="enhancing"
        :llm-label="llmLabel"
        :vision-enabled="settings.state.llm.sendImages"
        :submit-label="t('studio.action.generate')"
        :run-target="runTarget"
        @update:prompt="(v) => draft.patch({ prompt: v })"
        @update:negative="(v) => draft.patch({ negative: v })"
        @update:structured="(v) => draft.patch({ structured: v })"
        @update:style-label="(v) => draft.patch({ style: v })"
        @submit="submit"
        @cancel="cancel()"
        @enhance="enhance(isImg2Img)"
        @reverse="reverse()"
        @apply-enhance="applyEnhance()"
        @discard-enhance="discardEnhance()"
        @save-to-library="savePromptToLibrary()"
        @replace-prompt="(v) => draft.patch({ prompt: v })"
      />
    </div>

    <div v-if="enhancing" class="float-toast">
      {{ enhanceKind === "reverse" ? t("studio.toast.reversing") : t("studio.toast.enhancing") }}
    </div>
  </div>
</template>

<style scoped>
.studio {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-app);
}
.studio-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
  padding: 12px 18px 0;
}
.studio-hint {
  font-size: var(--fs-12);
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.channel-select {
  width: auto;
  max-width: 240px;
  height: 30px;
  font-size: var(--fs-12);
}
.workbench {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 314px minmax(0, 1fr) 352px;
  gap: 14px;
  padding: 12px 18px 18px;
}
.wb-left,
.wb-center,
.wb-right {
  min-height: 0;
}
.float-toast {
  position: absolute;
  bottom: 26px;
  left: 50%;
  transform: translateX(-50%);
  padding: 9px 16px;
  border-radius: var(--r-full);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-md);
  font-size: var(--fs-12);
  color: var(--text-secondary);
}

@media (max-width: 1440px) {
  .workbench {
    grid-template-columns: 288px minmax(0, 1fr) 334px;
  }
}
@media (max-width: 1200px) {
  .studio-hint {
    display: none;
  }
}
</style>

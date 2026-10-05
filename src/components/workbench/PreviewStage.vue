<script setup lang="ts">
import { computed, ref } from "vue";
import type { GeneratedImage, StructuredPrompt, TaskStatus } from "../../types";
import { copyText, formatDuration, formatTime, sizeLabel } from "../../platform/env";
import { revealInFolder } from "../../platform/storage";
import { useSettingsStore } from "../../stores/settings";
import { useUiStore } from "../../stores/ui";
import { useUpscaleStore } from "../../stores/upscale";
import { upscaleImage, toGeneratedImage, type UpscaleResult } from "../../services/upscale";
import { t } from "../../i18n";
import UiIcon from "../ui/UiIcon.vue";
import UiSmartImage from "../ui/UiSmartImage.vue";
import UiImageViewer from "../ui/UiImageViewer.vue";

const props = withDefaults(
  defineProps<{
    title: string;
    images: GeneratedImage[];
    activeIndex: number;
    status: TaskStatus;
    progressText?: string;
    elapsed?: number;
    prompt: string;
    negative?: string;
    structured?: StructuredPrompt | null;
    styleLabel?: string;
    /** 工作流任务的画幅由工作流自己决定，传空串表示不展示尺寸 */
    size: string;
    count: number;
    finishedAt?: number;
    emptyHint?: string;
  }>(),
  {
    progressText: "",
    elapsed: 0,
    negative: "",
    structured: null,
    styleLabel: "",
    finishedAt: 0,
    emptyHint: "",
  },
);

const emit = defineEmits<{
  "update:activeIndex": [value: number];
  download: [image: GeneratedImage];
  reuse: [];
  clear: [];
  editPrompt: [];
  /** 超分完成：产物是独立新图，由父组件追加进 images 并登记历史 */
  upscaled: [payload: { image: GeneratedImage; result: UpscaleResult; sourceId: string }];
}>();

const ui = useUiStore();
const settings = useSettingsStore();
const upscale = useUpscaleStore();
const viewerOpen = ref(false);
/** 正在超分的图片 id（同一时刻只跑一张，CPU 推理不该并发） */
const upscalingId = ref("");

const current = computed(() => props.images[props.activeIndex] ?? null);
const total = computed(() => props.images.length);
const running = computed(() => props.status === "running" || props.status === "queued");

/** 父级没给空态提示时用通用那句 */
const emptyHintText = computed(() => props.emptyHint || t("studio.preview.empty.hint"));

/**
 * 超分入口的可用性。
 * 三道门：用户开了开关、本机有模型、当前图有本地文件（推理要读盘）。
 * 少任一条就置灰并说明原因——按钮灰着不给理由等于让用户猜。
 */
const upscaleHint = computed(() => {
  if (upscalingId.value) return t("studio.preview.upscale.running");
  if (!upscale.enabled) return t("studio.preview.upscale.needEnable");
  if (!upscale.available) return t("studio.preview.upscale.needModel");
  if (!current.value?.path) return t("studio.preview.upscale.noLocalFile");
  return t("studio.preview.upscale.ready", {
    model: upscale.activeModel?.label ?? t("studio.preview.upscale.modelFallback"),
    scale: upscale.activeModel?.scale ?? 4,
  });
});

const canUpscale = computed(
  () => upscale.enabled && upscale.available && Boolean(current.value?.path) && !upscalingId.value,
);

/** 运行中的一行提示：工作流没有固定尺寸，就别硬凑一个「尺寸自动」 */
const runningHint = computed(() => {
  if (!props.size) return t("studio.preview.running.taskSubmitted", { count: props.count });
  return t("studio.preview.running.sizeAndCount", { size: sizeLabel(props.size), count: props.count });
});

/** 状态枚举保持原样（父组件按它分支），只把展示名换成词条查表 */
const statusTag = computed(() => {
  if (running.value) return { label: props.progressText || t("studio.preview.status.running"), cls: "tag-warning" };
  if (props.status === "success")
    return { label: t("studio.preview.status.success", { count: total.value }), cls: "tag-success" };
  if (props.status === "failed") return { label: t("studio.preview.status.failed"), cls: "tag-danger" };
  if (props.status === "canceled") return { label: t("studio.preview.status.canceled"), cls: "tag" };
  return { label: t("studio.preview.status.idle"), cls: "tag" };
});

/** 结构化拆解的槽位名是数据侧的固定 key，这里只换成展示名 */
const chips = computed(() => {
  const s = props.structured;
  const list: Array<{ label: string; value: string }> = [];
  if (s) {
    if (s.subject) list.push({ label: t("studio.prompt.field.subject"), value: s.subject });
    if (s.scene) list.push({ label: t("studio.prompt.field.scene"), value: s.scene });
    if (s.style) list.push({ label: t("studio.prompt.field.style"), value: s.style });
    if (s.lens) list.push({ label: t("studio.prompt.field.lens"), value: s.lens });
    if (s.lighting) list.push({ label: t("studio.prompt.field.lighting"), value: s.lighting });
    if (s.color) list.push({ label: t("studio.prompt.field.color"), value: s.color });
  }
  return list;
});

function step(delta: number) {
  if (total.value < 2) return;
  const next = (props.activeIndex + delta + total.value) % total.value;
  emit("update:activeIndex", next);
}

async function copyPrompt() {
  const ok = await copyText(props.prompt);
  if (ok) ui.success(t("studio.toast.promptCopied"));
  else ui.warning(t("studio.toast.copyFailed.title"), t("studio.toast.copyFailed.desc"));
}

/** 在系统文件管理器中定位当前图片 */
async function revealCurrent() {
  const image = current.value;
  if (!image) return;
  if (!image.path) {
    ui.warning(
      t("studio.toast.noLocalFile.title"),
      settings.useDemo ? t("studio.toast.noLocalFile.demo") : t("studio.toast.noLocalFile.checkSetting"),
    );
    return;
  }
  const res = await revealInFolder(image.path);
  if (res.ok) ui.success(t("studio.toast.revealDone"));
  else ui.warning(t("studio.toast.revealFailed.title"), res.error ?? t("studio.toast.revealFailed.desktopOnly"));
}

/**
 * 超分当前图。
 *
 * **产物作为新图追加，不覆盖原图**——用户要的是「对比着看」，
 * 原地覆盖会让他连原图都找不回来。父组件把它 push 进 images 数组。
 *
 * 这里刻意不直接写 history：PreviewStage 是纯展示组件，
 * 不知道这次生图对应哪条记录。历史登记由调用方（视图层）在拿到结果后做，
 * 否则会造出「有图但无记录」的孤儿文件。
 */
async function runUpscale() {
  const image = current.value;
  if (!image || !canUpscale.value) return;
  const model = upscale.activeModel;
  if (!model) return;

  upscalingId.value = image.id;
  const startedAt = Date.now();
  try {
    const result = await upscaleImage(image, model.id);
    emit("upscaled", { image: toGeneratedImage(result), result, sourceId: image.id });
    ui.success(
      t("studio.toast.upscaleDone.title", { width: result.width, height: result.height }),
      t("studio.toast.upscaleDone.desc", { seconds: ((Date.now() - startedAt) / 1000).toFixed(1) }),
    );
  } catch (err) {
    ui.requestFailed(t("studio.toast.upscaleFailed.title"), err);
  } finally {
    upscalingId.value = "";
  }
}
</script>

<template>
  <div class="stage card">
    <header class="stage-head">
      <span class="row gap-2">
        <span class="stage-dot" :class="{ 'is-running': running }" />
        <span class="stage-title">{{ title }}</span>
        <span class="tag" :class="statusTag.cls">{{ statusTag.label }}</span>
      </span>
      <span class="row gap-2">
        <span v-if="elapsed" class="t-xs t-3rd">{{ formatDuration(elapsed) }}</span>
        <span v-if="finishedAt" class="t-xs t-3rd">{{ formatTime(finishedAt) }}</span>
        <button
          v-if="upscale.enabled"
          class="icon-btn"
          :title="upscaleHint"
          :disabled="!canUpscale"
          @click="runUpscale"
        >
          <UiIcon name="spark" :size="16" :class="{ spin: Boolean(upscalingId) }" />
        </button>
        <button
          class="icon-btn"
          :title="t('studio.preview.action.download')"
          :disabled="!current"
          @click="current && emit('download', current)"
        >
          <UiIcon name="download" :size="16" />
        </button>
        <button
          class="icon-btn"
          :title="t('studio.preview.action.reveal')"
          :disabled="!current"
          @click="revealCurrent"
        >
          <UiIcon name="folder-open" :size="16" />
        </button>
        <button class="icon-btn" :title="t('studio.preview.action.clear')" :disabled="!total" @click="emit('clear')">
          <UiIcon name="trash" :size="16" />
        </button>
      </span>
    </header>

    <div class="canvas" :class="{ 'is-busy': running }">
      <!-- 主画布给足 1024：它是用户正在盯着看的图，缩太小会明显发虚 -->
      <UiSmartImage
        v-if="current"
        :image="current"
        :alt="t('studio.preview.title')"
        contain
        :icon-size="28"
        :eager="true"
        :thumb-edge="1024"
      />
      <div v-else class="canvas-empty">
        <span class="empty-icon">
          <UiIcon :name="running ? 'spark' : 'image'" :size="24" :class="{ spin: running }" />
        </span>
        <p class="t-md t-2nd">{{ running ? progressText || t("studio.preview.status.running") : t("studio.preview.empty.canvas") }}</p>
        <p class="t-xs t-3rd">{{ running ? runningHint : emptyHintText }}</p>
        <div v-if="running" class="progress-track"><span class="progress-fill" /></div>
      </div>

      <template v-if="total > 1">
        <button class="nav-btn is-prev" :title="t('studio.preview.action.prev')" @click="step(-1)">
          <UiIcon name="chevron-left" :size="18" />
        </button>
        <button class="nav-btn is-next" :title="t('studio.preview.action.next')" @click="step(1)">
          <UiIcon name="chevron-right" :size="18" />
        </button>
        <span class="counter">{{ t("studio.preview.counter", { index: activeIndex + 1, total }) }}</span>
      </template>

      <button v-if="current" class="expand-btn" :title="t('studio.preview.action.expand')" @click="viewerOpen = true">
        <UiIcon name="maximize" :size="15" />
      </button>
      <span v-if="styleLabel" class="style-badge">{{ styleLabel }}</span>
    </div>

    <div class="thumbs">
      <button
        v-for="(image, index) in images"
        :key="image.id"
        class="thumb"
        :class="{ 'is-active': index === activeIndex }"
        @click="emit('update:activeIndex', index)"
      >
        <UiSmartImage :image="image" :icon-size="16" />
      </button>
      <button
        v-if="status === 'success'"
        class="thumb thumb-add"
        :title="t('studio.preview.action.reuse')"
        @click="emit('reuse')"
      >
        <UiIcon name="plus" :size="17" />
      </button>
    </div>

    <div class="prompt-card">
      <div class="row-between">
        <span class="section-label">{{ t("studio.preview.promptSection") }}</span>
        <span class="row gap-1">
          <button class="icon-btn" :title="t('studio.preview.copyPrompt')" :disabled="!prompt" @click="copyPrompt">
            <UiIcon name="copy" :size="15" />
          </button>
          <button class="icon-btn" :title="t('studio.preview.editPrompt')" @click="emit('editPrompt')">
            <UiIcon name="edit" :size="15" />
          </button>
        </span>
      </div>
      <p class="prompt-text clamp-3">{{ prompt || t("studio.preview.promptEmpty") }}</p>
      <p v-if="negative" class="negative-text clamp-2">
        <span class="t-3rd">{{ t("studio.preview.negativeLabel") }}</span>{{ negative }}
      </p>
      <div v-if="chips.length" class="chip-row">
        <span v-for="chip in chips" :key="chip.label" class="chip">
          <span class="chip-label">{{ chip.label }}</span>
          <span class="chip-value">{{ chip.value }}</span>
        </span>
      </div>
    </div>

    <!-- 大图查看：与历史记录共用同一个灯箱组件 -->
    <UiImageViewer
      v-model:open="viewerOpen"
      :images="images"
      :index="activeIndex"
      :meta="size ? sizeLabel(size) : ''"
      @update:index="emit('update:activeIndex', $event)"
    />
  </div>
</template>

<style scoped>
.stage {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}
.stage-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
.stage-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-faint);
}
.stage-dot.is-running {
  background: var(--warning);
  animation: pulse-soft 1.3s ease-in-out infinite;
}
.stage-title {
  font-size: var(--fs-14);
  font-weight: 650;
}

.canvas {
  position: relative;
  flex: 1;
  min-height: 0;
  margin: 16px;
  border-radius: var(--r-lg);
  background: var(--canvas);
  overflow: hidden;
  display: grid;
  place-items: center;
}
.canvas.is-busy {
  background:
    radial-gradient(120% 80% at 50% 0%, var(--accent-soft) 0%, transparent 60%),
    var(--canvas);
}
.canvas :deep(.smart) {
  background: transparent;
}
.canvas-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
  color: var(--text-tertiary);
}
.progress-track {
  width: 180px;
  height: 4px;
  margin-top: 6px;
  border-radius: 999px;
  background: var(--bg-muted);
  overflow: hidden;
}
.progress-fill {
  display: block;
  width: 40%;
  height: 100%;
  border-radius: 999px;
  background: var(--brand-grad);
  animation: slide 1.3s var(--ease) infinite;
}
@keyframes slide {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(250%);
  }
}

.nav-btn {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 50%;
  background: rgba(16, 18, 24, 0.5);
  color: #fff;
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--dur) var(--ease), background var(--dur) var(--ease);
}
.canvas:hover .nav-btn {
  opacity: 1;
}
.nav-btn:hover {
  background: rgba(16, 18, 24, 0.72);
}
.nav-btn.is-prev {
  left: 14px;
}
.nav-btn.is-next {
  right: 14px;
}
.counter {
  position: absolute;
  right: 14px;
  bottom: 12px;
  padding: 3px 9px;
  border-radius: var(--r-full);
  background: rgba(16, 18, 24, 0.55);
  color: #fff;
  font-size: var(--fs-11);
  font-variant-numeric: tabular-nums;
}
.expand-btn {
  position: absolute;
  left: 14px;
  bottom: 12px;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: var(--r-sm);
  background: rgba(16, 18, 24, 0.5);
  color: #fff;
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--dur) var(--ease);
}
.canvas:hover .expand-btn {
  opacity: 1;
}
.style-badge {
  position: absolute;
  top: 12px;
  left: 14px;
  padding: 3px 9px;
  border-radius: var(--r-full);
  background: rgba(16, 18, 24, 0.5);
  color: #fff;
  font-size: var(--fs-11);
}

.thumbs {
  display: flex;
  gap: 8px;
  padding: 0 16px 14px;
  overflow-x: auto;
}
.thumb {
  position: relative;
  width: 62px;
  height: 62px;
  flex: none;
  padding: 0;
  border: 2px solid transparent;
  border-radius: var(--r-md);
  overflow: hidden;
  background: var(--bg-muted);
  cursor: pointer;
  transition: border-color var(--dur) var(--ease), transform var(--dur) var(--ease);
}
.thumb:hover {
  transform: translateY(-1px);
}
.thumb.is-active {
  border-color: var(--accent);
}
.thumb-add {
  display: grid;
  place-items: center;
  border: 1px dashed var(--border-strong);
  background: var(--bg-surface);
  color: var(--text-tertiary);
}
.thumb-add:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.prompt-card {
  padding: 14px 16px 16px;
  border-top: 1px solid var(--border);
  background: var(--bg-subtle);
}
.prompt-text {
  margin-top: 8px;
  font-size: var(--fs-12);
  line-height: 1.65;
  color: var(--text-secondary);
  word-break: break-word;
}
.negative-text {
  margin-top: 6px;
  font-size: var(--fs-11);
  line-height: 1.6;
  color: var(--text-tertiary);
}
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: var(--r-full);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  font-size: var(--fs-11);
  max-width: 100%;
}
.chip-label {
  color: var(--text-tertiary);
}
.chip-value {
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 150px;
}

</style>

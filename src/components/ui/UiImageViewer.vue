<script setup lang="ts">
import { t } from "../../i18n";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import type { GeneratedImage } from "../../types";
import UiIcon from "./UiIcon.vue";
import UiSmartImage from "./UiSmartImage.vue";

/**
 * 大图查看器（灯箱）。
 * 全屏遮罩 + 键盘导航（← → 翻页 / Esc 关闭），支持「适应窗口 ⇄ 原始尺寸 1:1」。
 * 图片地址由 UiSmartImage 统一解析（本地文件 → 远端链接 → 内联数据），
 * 这里只负责呈现与交互。操作按钮通过 `#actions` 插槽由调用方按需提供。
 */
const props = withDefaults(
  defineProps<{
    open: boolean;
    images: GeneratedImage[];
    /** 当前下标，配合 v-model:index 使用 */
    index?: number;
    /** 左下角补充信息，如尺寸、时间 */
    meta?: string;
  }>(),
  { index: 0, meta: "" },
);

const emit = defineEmits<{
  "update:open": [value: boolean];
  "update:index": [value: number];
}>();

const stage = ref<HTMLElement | null>(null);
/** true = 原始尺寸（可滚动查看），false = 适应窗口 */
const actual = ref(false);
const natural = ref<{ width: number; height: number } | null>(null);
const failed = ref(false);

const total = computed(() => props.images.length);
const current = computed<GeneratedImage | null>(() => props.images[props.index] ?? null);
const hasMultiple = computed(() => total.value > 1);

const sizeText = computed(() => {
  const size = natural.value;
  if (!size) return "";
  return `${size.width} × ${size.height}`;
});

function step(delta: number) {
  if (!hasMultiple.value) return;
  emit("update:index", (props.index + delta + total.value) % total.value);
}

function close() {
  emit("update:open", false);
}

function toggleScale() {
  actual.value = !actual.value;
}

/** 图片加载完成后从 DOM 读真实像素，用于展示尺寸与 1:1 模式 */
async function readNaturalSize() {
  await nextTick();
  const img = stage.value?.querySelector("img");
  if (!img) return;
  const probe = () => {
    if (img.naturalWidth) natural.value = { width: img.naturalWidth, height: img.naturalHeight };
  };
  if (img.complete) probe();
  else img.addEventListener("load", probe, { once: true });
}

function reset() {
  actual.value = false;
  natural.value = null;
  failed.value = false;
}

function onReady() {
  failed.value = false;
  void readNaturalSize();
}

/** Esc 用捕获阶段 + stopImmediatePropagation，避免同时关掉下层的抽屉 */
function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.stopImmediatePropagation();
    close();
  } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    step(event.key === "ArrowLeft" ? -1 : 1);
  }
}

watch(
  () => [props.open, props.index] as const,
  ([open]) => {
    if (open) reset();
  },
);

watch(
  () => props.open,
  (open) => {
    if (open) window.addEventListener("keydown", onKeydown, true);
    else window.removeEventListener("keydown", onKeydown, true);
  },
  { immediate: true },
);

onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown, true));
</script>

<template>
  <Teleport to="body">
    <Transition name="viewer">
      <div
        v-if="open && current"
        class="viewer"
        :class="{ 'is-actual': actual }"
        data-tauri-drag-region="false"
        @click.self="close"
      >
        <div ref="stage" class="viewer-stage" @click.self="close">
          <div class="viewer-canvas" @dblclick="toggleScale">
            <UiSmartImage
              v-if="!failed"
              :key="current.id"
              :image="current"
              contain
              :icon-size="34"
              :eager="true"
              :thumb-edge="actual ? 0 : 1024"
              :preview-edge="512"
              @ready="onReady"
              @failed="failed = true"
            />
            <div v-else class="viewer-broken">
              <UiIcon name="image" :size="34" />
              <p class="t-sm">{{ t("common.imageLoadFailed") }}</p>
            </div>
          </div>
        </div>

        <button class="viewer-close" :title="t('common.closeTitle')" @click="close">
          <UiIcon name="close" :size="18" />
        </button>

        <template v-if="hasMultiple">
          <button class="viewer-nav is-prev" :title="t('common.prevImage')" @click.stop="step(-1)">
            <UiIcon name="chevron-left" :size="20" />
          </button>
          <button class="viewer-nav is-next" :title="t('common.nextImage')" @click.stop="step(1)">
            <UiIcon name="chevron-right" :size="20" />
          </button>
        </template>

        <div class="viewer-bar">
          <span class="viewer-count">{{ index + 1 }} / {{ total }}</span>
          <span v-if="sizeText" class="viewer-size">{{ sizeText }}</span>
          <span v-if="meta" class="viewer-meta">{{ meta }}</span>

          <span class="viewer-spacer" />

          <slot name="actions" :image="current" />

          <button
            class="viewer-btn"
            :title="actual ? t('common.fitWindow') : t('common.actualSize')"
            @click.stop="toggleScale"
          >
            <UiIcon :name="actual ? 'aspect-ratio' : 'maximize'" :size="16" />
            <span>{{ actual ? t("common.fitWindow") : "1:1" }}</span>
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.viewer {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  background: rgba(8, 10, 14, 0.92);
  backdrop-filter: blur(2px);
  user-select: none;
}
.viewer-stage {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: auto;
  padding: 44px 72px 16px;
}
.viewer-canvas {
  margin: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: zoom-in;
}
.viewer.is-actual .viewer-canvas {
  cursor: zoom-out;
}
/* 下面几条必须显式拉高权重：UiSmartImage 内部是 `.smart.is-contain img[data-v]`（0,3,1），
   只写 `.viewer :deep(img)`（0,3,1）会打平、胜负取决于样式注入顺序。 */
.viewer .viewer-stage .viewer-canvas :deep(.smart) {
  width: auto;
  height: auto;
  max-width: min(92vw, 1400px);
  max-height: 76vh;
  background: transparent;
}
.viewer .viewer-stage .viewer-canvas :deep(img) {
  width: auto;
  height: auto;
  max-width: min(92vw, 1400px);
  max-height: 76vh;
  object-fit: contain;
  border-radius: var(--r-sm);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.5);
}
/* 原始尺寸：按真实像素展示，超出部分可滚动 */
.viewer.is-actual .viewer-stage .viewer-canvas :deep(.smart),
.viewer.is-actual .viewer-stage .viewer-canvas :deep(img) {
  max-width: none;
  max-height: none;
}
.viewer.is-actual .viewer-stage .viewer-canvas :deep(img) {
  border-radius: 0;
}

.viewer-broken {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 40px;
  color: rgba(255, 255, 255, 0.6);
}

.viewer-close {
  position: absolute;
  top: 18px;
  right: 22px;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  cursor: pointer;
}
.viewer-close:hover {
  background: rgba(255, 255, 255, 0.24);
}

.viewer-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  cursor: pointer;
}
.viewer-nav:hover {
  background: rgba(255, 255, 255, 0.26);
}
.viewer-nav.is-prev {
  left: 18px;
}
.viewer-nav.is-next {
  right: 18px;
}

.viewer-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 22px 18px;
  color: rgba(255, 255, 255, 0.82);
  font-size: var(--fs-12);
}
.viewer-count,
.viewer-size,
.viewer-meta {
  padding: 4px 11px;
  border-radius: var(--r-full);
  background: rgba(255, 255, 255, 0.12);
}
.viewer-meta {
  max-width: 46vw;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.viewer-spacer {
  flex: 1;
}
.viewer-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--r-full);
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  font-size: var(--fs-12);
  cursor: pointer;
}
.viewer-btn:hover {
  background: rgba(255, 255, 255, 0.26);
}
.viewer-btn :deep(.ui-icon) {
  flex: none;
}
/* #actions 插槽内容由调用方编译（带的是父组件作用域），统一在这里给按钮造型 */
.viewer-bar :slotted(button) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--r-full);
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  font-size: var(--fs-12);
  cursor: pointer;
}
.viewer-bar :slotted(button:hover) {
  background: rgba(255, 255, 255, 0.26);
}

.viewer-enter-active,
.viewer-leave-active {
  transition: opacity 0.18s var(--ease);
}
.viewer-enter-from,
.viewer-leave-to {
  opacity: 0;
}
</style>

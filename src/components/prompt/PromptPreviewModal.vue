<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { PromptItem } from "../../types";
import { PROMPT_CATEGORIES } from "../../stores/prompts";
import { sourceShortNameOf } from "../../services/promptRepo";
import { formatTime } from "../../platform/env";
import { t } from "../../i18n";
import RemoteImage from "./RemoteImage.vue";
import UiModal from "../ui/UiModal.vue";
import UiIcon from "../ui/UiIcon.vue";

/** 分类名 → 展示词条，下标与 PROMPT_CATEGORIES 一一对应（分类名本身是数据，不能翻译） */
const CATEGORY_KEYS = [
  "prompts.category.portrait",
  "prompts.category.scene",
  "prompts.category.product",
  "prompts.category.ecommerce",
  "prompts.category.advertising",
  "prompts.category.poster",
  "prompts.category.illustration",
  "prompts.category.character",
  "prompts.category.ui",
  "prompts.category.architecture",
  "prompts.category.concept",
  "prompts.category.community",
  "prompts.category.other",
];

/**
 * 案例详情：大图 + 完整提示词。
 * 缩略图看不清细节，这里给一个能放大的主图区；多图案例用底部小图切换。
 */
const props = defineProps<{
  open: boolean;
  item: PromptItem | null;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  copy: [item: PromptItem];
  source: [item: PromptItem];
  use: [item: PromptItem];
}>();

const images = computed(() => props.item?.images ?? []);
const repoLabel = computed(() => (props.item?.source === "repo" ? sourceShortNameOf(props.item.repo) : t("prompts.preview.localSource")));

/** 分类名是数据，展示时才按词条翻 */
const categoryLabel = computed(() => {
  const name = props.item?.category;
  if (!name) return "";
  const index = PROMPT_CATEGORIES.indexOf(name);
  const key = index >= 0 ? CATEGORY_KEYS[index] : "";
  return key ? t(key) : name;
});

const activeIndex = ref(0);
const active = computed(() => images.value[activeIndex.value] ?? images.value[0] ?? "");

// 换一条案例就回到第一张图
watch(
  () => props.item?.id,
  () => {
    activeIndex.value = 0;
  },
);
</script>

<template>
  <UiModal :open="open" :width="880" @update:open="emit('update:open', $event)">
    <template #header>
      <div class="grow" style="min-width: 0">
        <h3 class="head-title t-ellipsis">{{ item?.title ?? t("prompts.preview.title") }}</h3>
        <p class="head-meta">
          <span class="tag">{{ categoryLabel }}</span>
          <span class="tag tag-info">{{ repoLabel }}</span>
          <span v-if="item?.author" class="t-xs t-3rd">@{{ item.author }}</span>
          <span v-if="item" class="t-xs t-faint">{{ formatTime(item.updatedAt) }}</span>
        </p>
      </div>
    </template>

    <div class="preview">
      <div v-if="images.length" class="gallery">
        <div class="hero">
          <RemoteImage mode="natural" :source="active" :alt="item?.title ?? ''" :icon-size="30" />
        </div>
        <div v-if="images.length > 1" class="shots">
          <button
            v-for="(url, index) in images"
            :key="url"
            class="shot"
            :class="{ 'is-active': index === activeIndex }"
            :title="t('prompts.preview.shotTitle', { index: index + 1 })"
            @click="activeIndex = index"
          >
            <RemoteImage :source="url" :alt="t('prompts.preview.shotAlt', { index: index + 1 })" :icon-size="16" />
          </button>
        </div>
      </div>
      <p v-else class="t-sm t-3rd">{{ t("prompts.preview.noImages") }}</p>

      <section class="block">
        <div class="row-between">
          <span class="section-label">
            {{ t("prompts.preview.promptLabel") }}
            <span class="t-xs t-faint">{{ t("prompts.preview.charCount", { count: item?.content.length ?? 0 }) }}</span>
          </span>
          <button class="link-btn" @click="item && emit('copy', item)">{{ t("common.copy") }}</button>
        </div>
        <pre class="prompt-text">{{ item?.content }}</pre>
      </section>

      <section v-if="item?.negative" class="block">
        <span class="section-label">{{ t("prompts.preview.negativeLabel") }}</span>
        <pre class="prompt-text is-short">{{ item.negative }}</pre>
      </section>
    </div>

    <template #footer>
      <button v-if="item?.sourceUrl" class="btn btn-sm" @click="item && emit('source', item)">
        <UiIcon name="link" :size="14" />{{ t("prompts.preview.viewSource") }}
      </button>
      <span class="grow" />
      <button class="btn btn-sm" @click="emit('update:open', false)">{{ t("common.close") }}</button>
      <button class="btn btn-sm btn-primary" :disabled="!item" @click="item && emit('use', item)">
        <UiIcon name="sparkles" :size="14" />{{ t("prompts.action.use") }}
      </button>
    </template>
  </UiModal>
</template>

<style scoped>
.preview {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.gallery {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
/* 主图区：固定高度由内容撑，图片按自身比例居中，两侧留底色而不是硬裁 */
.hero {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 220px;
  max-height: 56vh;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  background: var(--bg-muted);
}
.hero :deep(.remote.is-natural img) {
  max-height: calc(56vh - 14px);
}
.shots {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.shot {
  width: 88px;
  aspect-ratio: 4 / 3;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-muted);
  overflow: hidden;
  cursor: pointer;
  transition: border-color var(--dur) var(--ease);
}
.shot:hover {
  border-color: var(--border-strong);
}
.shot.is-active {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}
.block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.link-btn {
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
.prompt-text {
  max-height: 34vh;
  overflow-y: auto;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-subtle);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: var(--fs-12);
  line-height: 1.75;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}
.prompt-text.is-short {
  max-height: 16vh;
}
.head-title {
  font-size: var(--fs-16);
  font-weight: 650;
}
.head-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 5px;
}
.head-meta .t-xs {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
</style>

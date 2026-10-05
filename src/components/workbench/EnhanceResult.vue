<script setup lang="ts">
/**
 * 增强结果展示：增强前 → 增强后对比 + 负向词 + 结构化拆解 + 改动说明 + 采纳 / 放弃。
 *
 * 「大模型生图」的提示词面板与「工作流生图」的输入槽位共用它——两处的用户都必须
 * 看到完整结果才能决定要不要采纳，不能再出现一边只显示一行改动说明的情况。
 * 结果本身不含宽高限制，容器多窄都换行显示全文。
 */
import { computed } from "vue";
import type { StructuredPrompt } from "../../types";
import { t } from "../../i18n";
import UiIcon from "../ui/UiIcon.vue";

/** 结构化拆解的展示顺序（与 PromptPanel 的填写区一致）；槽位名是数据，展示名走词条 */
const FIELDS: Array<{ key: keyof StructuredPrompt; label: string }> = [
  { key: "subject", label: "studio.prompt.field.subject" },
  { key: "scene", label: "studio.prompt.field.scene" },
  { key: "style", label: "studio.prompt.field.style" },
  { key: "lens", label: "studio.prompt.field.lens" },
  { key: "lighting", label: "studio.prompt.field.lighting" },
  { key: "color", label: "studio.prompt.field.color" },
];

const props = withDefaults(
  defineProps<{
    /** 增强后的正向提示词 */
    prompt: string;
    /**
     * 结果来源：
     * - enhance：改写用户的想法，画「增强前 → 增强后」对比
     * - reverse：从图片/参数反推，没有「前」，只呈现结果
     */
    variant?: "enhance" | "reverse";
    /** 增强前的提示词，用于对比 */
    original?: string;
    negative?: string;
    structured?: StructuredPrompt | null;
    notes?: string[];
    /** 是否已被采纳 */
    applied?: boolean;
    /** 动作条吸底（父容器自身滚动时用，保证关键动作始终可见） */
    stickyActions?: boolean;
  }>(),
  {
    variant: "enhance",
    original: "",
    negative: "",
    structured: null,
    notes: () => [],
    applied: false,
    stickyActions: false,
  },
);

const emit = defineEmits<{ apply: []; discard: [] }>();

const isReverse = computed(() => props.variant === "reverse");

const fieldRows = computed(() => {
  const source = props.structured;
  if (!source) return [];
  return FIELDS.map((field) => ({ key: field.key, label: t(field.label), value: source[field.key] })).filter(
    (row) => row.value,
  );
});

/** 标题、采纳按钮与底部说明都按 variant 取词条：增强是 studio.enhance.*，反推是 studio.reverse.* */
const resultTitle = computed(() => (isReverse.value ? t("studio.reverse.resultTitle") : t("studio.enhance.resultTitle")));

const applyLabel = computed(() => {
  if (props.applied) return t("studio.enhance.applyDone");
  return isReverse.value ? t("studio.reverse.apply") : t("studio.enhance.apply");
});

const applyHint = computed(() => {
  if (isReverse.value) {
    return props.applied ? t("studio.reverse.hintApplied") : t("studio.reverse.hintPending");
  }
  return props.applied ? t("studio.enhance.hintApplied") : t("studio.enhance.hintPending");
});
</script>

<template>
  <div class="enh-result">
    <div class="result-head">
      <span class="result-title">
        <UiIcon :name="isReverse ? 'wand' : 'sparkles'" :size="13" />{{ resultTitle }}
      </span>
      <span v-if="applied" class="tag tag-success"><UiIcon name="check" :size="12" />{{ t("studio.enhance.appliedTag") }}</span>
      <span v-else class="tag tag-warning">{{ t("studio.enhance.pendingTag") }}</span>
    </div>

    <!-- 反推没有「前」，只呈现结果；增强则做全文前后对比（不做行数截断） -->
    <div v-if="isReverse" class="compare-box">
      <div class="compare-col is-result">
        <span class="preview-label">{{ t("studio.reverse.promptLabel") }}</span>
        <p class="compare-text">{{ prompt }}</p>
      </div>
    </div>
    <div v-else class="compare-box">
      <div class="compare-col">
        <span class="preview-label">{{ t("studio.enhance.before") }}</span>
        <p class="compare-text is-muted">{{ original || t("studio.enhance.originalEmpty") }}</p>
      </div>
      <span class="compare-arrow"><UiIcon name="chevron-right" :size="14" /></span>
      <div class="compare-col is-result">
        <span class="preview-label">{{ t("studio.enhance.after") }}</span>
        <p class="compare-text">{{ prompt }}</p>
      </div>
    </div>

    <div v-if="negative" class="result-box">
      <span class="preview-label">{{ t("studio.enhance.negativeLabel") }}</span>
      <p class="result-text">{{ negative }}</p>
    </div>

    <div v-if="fieldRows.length" class="result-box">
      <span class="preview-label">{{ t("studio.enhance.structuredLabel") }}</span>
      <div class="kv-list">
        <div v-for="row in fieldRows" :key="row.key" class="kv-row">
          <span class="kv-key">{{ row.label }}</span>
          <span class="kv-val">{{ row.value }}</span>
        </div>
      </div>
    </div>

    <div v-if="notes.length" class="notes">
      <span class="preview-label">{{ t("studio.enhance.notesLabel") }}</span>
      <ul class="notes-list">
        <li v-for="(note, index) in notes" :key="index">
          <UiIcon name="check" :size="12" />{{ note }}
        </li>
      </ul>
    </div>

    <div class="apply-row" :class="{ 'is-sticky': stickyActions }">
      <button class="btn btn-brand grow" :disabled="applied" @click="emit('apply')">
        <UiIcon name="check" :size="15" />
        {{ applyLabel }}
      </button>
      <button class="btn" @click="emit('discard')">
        <UiIcon name="close" :size="15" />{{ t("studio.enhance.discard") }}
      </button>
    </div>
    <p class="apply-hint">{{ applyHint }}</p>
  </div>
</template>

<style scoped>
.enh-result {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.result-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.result-title {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--fs-13);
  font-weight: 600;
}

.preview-label {
  display: block;
  margin-bottom: 4px;
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-faint);
}

/* 面板与左栏都偏窄，前后对比纵向排布更耐读 */
.compare-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.compare-col {
  min-width: 0;
  padding: 9px 11px;
  border-radius: var(--r-md);
  background: var(--bg-muted);
}
.compare-col.is-result {
  background: var(--bg-surface);
  border: 1px solid var(--border);
}
.compare-text {
  font-size: var(--fs-12);
  line-height: 1.6;
  color: var(--text);
  word-break: break-word;
  white-space: pre-wrap;
}
.compare-text.is-muted {
  color: var(--text-tertiary);
}
.compare-arrow {
  align-self: center;
  display: grid;
  place-items: center;
  color: var(--text-faint);
  transform: rotate(90deg);
}

.result-box {
  padding: 10px 12px;
  border-radius: var(--r-md);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  font-size: var(--fs-12);
  line-height: 1.6;
}
.result-text {
  color: var(--text);
  word-break: break-word;
  white-space: pre-wrap;
}

.kv-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.kv-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: var(--fs-12);
  line-height: 1.55;
}
.kv-key {
  flex: none;
  width: 30px;
  color: var(--text-faint);
}
.kv-val {
  flex: 1;
  min-width: 0;
  color: var(--text-secondary);
  word-break: break-word;
}

.notes-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.notes-list li {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: var(--fs-12);
  color: var(--text-secondary);
}
.notes-list :deep(svg) {
  color: var(--success);
  margin-top: 3px;
}

.apply-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
/**
 * 采纳/放弃是关键动作，父容器再长也要一直可见：
 * 负向 margin 用来抵消父容器的内边距，让动作条铺满整宽。
 */
.apply-row.is-sticky {
  position: sticky;
  bottom: 0;
  z-index: 2;
  margin: 0 -16px;
  padding: 10px 16px 12px;
  background: var(--bg-surface);
  border-top: 1px solid var(--border);
}
.apply-hint {
  font-size: var(--fs-11);
  color: var(--text-tertiary);
  line-height: 1.5;
}
</style>

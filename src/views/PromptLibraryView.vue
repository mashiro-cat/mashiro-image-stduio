<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import type { PromptItem } from "../types";
import { PROMPT_CATEGORIES, usePromptStore } from "../stores/prompts";
import { useDraftStore } from "../stores/draft";
import { useUiStore } from "../stores/ui";
import { useSettingsStore } from "../stores/settings";
import { copyText, formatRelative, openExternal } from "../platform/env";
import { sourceShortNameOf } from "../services/promptRepo";
import { openFilePicker } from "../composables/useWorkbenchActions";
import { studioRoute } from "../router/studio";
import { t } from "../i18n";
import UiIcon from "../components/ui/UiIcon.vue";
import UiEmpty from "../components/ui/UiEmpty.vue";
import UiSegmented from "../components/ui/UiSegmented.vue";
import PromptEditorModal from "../components/prompt/PromptEditorModal.vue";
import PromptRepoModal from "../components/prompt/PromptRepoModal.vue";
import PromptPreviewModal from "../components/prompt/PromptPreviewModal.vue";
import RemoteImage from "../components/prompt/RemoteImage.vue";

const router = useRouter();
const prompts = usePromptStore();
const draft = useDraftStore();
const ui = useUiStore();
const settings = useSettingsStore();

const editorOpen = ref(false);
const repoOpen = ref(false);
const previewOpen = ref(false);
const previewItem = ref<PromptItem | null>(null);
const editing = ref<PromptItem | null>(null);

const viewMode = ref<"grid" | "list">("grid");

/** 库里有上千条仓库案例，一次性渲染会卡，所以按页渲染 */
const PAGE_SIZE = 24;
const page = ref(1);
const listTop = ref<HTMLElement | null>(null);
const totalPages = computed(() => Math.max(1, Math.ceil(prompts.filtered.length / PAGE_SIZE)));
const visibleItems = computed(() => prompts.filtered.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

/** 页码按钮：首尾 + 当前附近，中间用省略号 */
const pageItems = computed<Array<number | "gap">>(() => {
  const total = totalPages.value;
  const current = page.value;
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set<number>([1, total, current - 1, current, current + 1]);
  const list = Array.from(set)
    .filter((n) => n >= 1 && n <= total)
    .sort((a, b) => a - b);
  const out: Array<number | "gap"> = [];
  let prev = 0;
  for (const n of list) {
    if (prev && n - prev > 1) out.push("gap");
    out.push(n);
    prev = n;
  }
  return out;
});

function gotoPage(next: number) {
  const target = Math.min(Math.max(1, next), totalPages.value);
  if (target === page.value) return;
  page.value = target;
  listTop.value?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// 过滤条件变化、或删到当前页空了 → 回到合理页码
watch(
  () => [
    prompts.keyword,
    prompts.activeCategory,
    prompts.activeTag,
    prompts.onlyFavorite,
    prompts.sourceKind,
    prompts.activeRepo,
    prompts.sortBy,
  ],
  () => {
    page.value = 1;
  },
);
watch(totalPages, (total) => {
  if (page.value > total) page.value = total;
});

/**
 * 分类名的展示映射。
 *
 * 分类名（人像/场景/产品…）既是 `PromptItem.category` 里的数据、又是筛选条件，
 * 翻成英文写回去会让老条目落到不存在的分类下。所以这里按下标把
 * PROMPT_CATEGORIES 与 prompts.category.* 词条一一对上，只在渲染期查表。
 */
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

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  PROMPT_CATEGORIES.map((name, index) => [name, CATEGORY_KEYS[index] ?? ""]),
);

function categoryLabel(name: string) {
  const key = CATEGORY_LABELS[name];
  return key ? t(key) : name;
}

const sourceFilters = computed(() => [
  { label: t("prompts.source.filterAll"), kind: "" as const, repo: "" },
  { label: t("prompts.source.filterBuiltin"), kind: "builtin" as const, repo: "" },
  { label: t("prompts.source.filterMine"), kind: "mine" as const, repo: "" },
  ...prompts.repoStats.map((item) => ({ label: item.name, kind: "repo" as const, repo: item.repo })),
]);

/** 标签按使用频次取前若干个，仓库案例带来的海量关键词不会把工具栏撑爆 */
const TAG_LIMIT = 18;
const tagExpanded = ref(false);
const hiddenTagCount = computed(() => Math.max(0, prompts.allTags.length - TAG_LIMIT));
const visibleTags = computed(() => {
  if (tagExpanded.value) return prompts.allTags;
  const head = prompts.allTags.slice(0, TAG_LIMIT);
  // 当前选中的标签必须可见，否则用户看不出为什么列表被过滤了
  if (prompts.activeTag && !head.includes(prompts.activeTag)) head.unshift(prompts.activeTag);
  return head;
});

function isSourceActive(kind: "" | "builtin" | "mine" | "repo", repo: string) {
  if (repo) return prompts.activeRepo === repo;
  if (kind === "repo") return prompts.sourceKind === "repo" && !prompts.activeRepo;
  return prompts.sourceKind === kind && !prompts.activeRepo;
}

const categoryOptions = computed(() => [
  { label: t("prompts.filter.allCategories"), value: "" },
  ...PROMPT_CATEGORIES.map((category) => ({ label: categoryLabel(category), value: category })),
]);

const sortOptions = computed(() => [
  { label: t("prompts.filter.sortUpdated"), value: "updated" },
  { label: t("prompts.filter.sortUsage"), value: "usage" },
  { label: t("prompts.filter.sortCreated"), value: "created" },
]);

function openCreate() {
  editing.value = null;
  editorOpen.value = true;
}

function openEdit(item: PromptItem) {
  editing.value = item;
  editorOpen.value = true;
}

function sendToStudio(item: PromptItem) {
  draft.handoff("text2img", {
    prompt: item.content,
    negative: item.negative,
    structured: item.structured ?? null,
    promptId: item.id,
    references: [],
  });
  prompts.markUsed(item.id);
  router.push(studioRoute("text2img"));
}

async function copyContent(item: PromptItem) {
  const ok = await copyText(item.negative ? `${item.content}\n\nNegative: ${item.negative}` : item.content);
  if (ok) {
    prompts.markUsed(item.id);
    ui.success(t("prompts.msg.copied"));
  } else {
    ui.warning(t("prompts.msg.copyFailed.title"), t("prompts.msg.copyFailed.desc"));
  }
}

/** 打开案例的原推 / 仓库文档，方便对照参考图 */
async function openSource(item: PromptItem) {
  const url = item.sourceUrl ?? "";
  const ok = url ? await openExternal(url) : false;
  if (!ok) ui.warning(t("prompts.msg.noSourceLink.title"), t("prompts.msg.noSourceLink.desc"));
}

/** 点缩略图看大图；没有效果图的条目直接跳来源 */
function openPreview(item: PromptItem) {
  if (!item.images?.length) {
    void openSource(item);
    return;
  }
  previewItem.value = item;
  previewOpen.value = true;
}

async function removeItem(item: PromptItem) {
  const ok = await ui.confirm({
    title: t("prompts.confirm.delete.title", { title: item.title }),
    message: t("prompts.confirm.delete.desc"),
    confirmText: t("common.delete"),
    tone: "danger",
  });
  if (!ok) return;
  prompts.remove(item.id);
  ui.success(t("common.deleteDone"));
}

function exportPrompts() {
  const data = prompts.exportItems();
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `mashiro-prompts-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  ui.success(t("prompts.msg.exported"), t("prompts.msg.exportedCount", { count: prompts.items.length }));
}

async function importPrompts() {
  const files = await openFilePicker({ accept: "application/json", multiple: false });
  if (!files.length) return;
  try {
    const text = await files[0].text();
    const count = prompts.importItems(JSON.parse(text), "merge");
    ui.success(t("prompts.msg.imported"), t("prompts.msg.importedCount", { count }));
  } catch (err) {
    ui.handleError(err, t("prompts.msg.importFailed"));
  }
}

const totalUsage = computed(() => prompts.items.reduce((sum, item) => sum + item.usageCount, 0));
</script>

<template>
  <div class="page">
    <div class="page-inner">
      <div class="page-head">
        <div>
          <h1 class="page-title">{{ t("prompts.title") }}</h1>
          <p class="page-sub">
            {{ t("prompts.stats", { count: prompts.items.length, usage: totalUsage }) }}
            <span v-if="prompts.repoTotal">{{ t("prompts.statsRepo", { count: prompts.repoTotal }) }}</span>
            <span v-if="settings.hasLlm">{{ t("prompts.statsLlmReady") }}</span>
            <span v-else>{{ t("prompts.statsLlmMissing") }}</span>
          </p>
        </div>
        <div class="row gap-2">
          <button class="btn" @click="repoOpen = true">
            <UiIcon name="cloud" :size="15" />{{ t("prompts.action.pullRepo") }}
          </button>
          <button class="btn" @click="importPrompts">
            <UiIcon name="upload" :size="15" />{{ t("prompts.action.import") }}
          </button>
          <button class="btn" @click="exportPrompts">
            <UiIcon name="download" :size="15" />{{ t("prompts.action.export") }}
          </button>
          <button class="btn btn-primary" @click="openCreate">
            <UiIcon name="plus" :size="15" />{{ t("prompts.action.create") }}
          </button>
        </div>
      </div>

      <!-- 工具栏 -->
      <div class="toolbar card">
        <div class="search-box">
          <UiIcon name="search" :size="15" />
          <input v-model="prompts.keyword" class="search-field" :placeholder="t('prompts.filter.searchPlaceholder')" />
          <button
            v-if="prompts.keyword"
            class="icon-btn"
            :title="t('common.reset')"
            @click="prompts.keyword = ''"
          >
            <UiIcon name="close" :size="14" />
          </button>
        </div>

        <div class="toolbar-row">
          <div class="filter-scroll">
            <button
              v-for="option in sourceFilters"
              :key="option.repo || option.kind || 'all'"
              class="tag tag-clickable"
              :class="{ 'tag-active': isSourceActive(option.kind, option.repo) }"
              @click="prompts.selectSource(option.kind, option.repo)"
            >
              {{ option.label }}
            </button>
          </div>
          <div class="row gap-2">
            <button
              class="tag tag-clickable"
              :class="{ 'tag-active': prompts.onlyFavorite }"
              @click="prompts.onlyFavorite = !prompts.onlyFavorite"
            >
              <UiIcon name="star" :size="11" />{{ t("prompts.filter.favorite") }}
            </button>
            <select v-model="prompts.sortBy" class="select" style="width: 118px">
              <option v-for="option in sortOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
            <UiSegmented
              v-model="viewMode"
              :options="[
                { label: '', value: 'grid', icon: 'grid' },
                { label: '', value: 'list', icon: 'list' },
              ]"
            />
          </div>
        </div>

        <div class="toolbar-row">
          <div class="filter-scroll">
            <button
              v-for="option in categoryOptions"
              :key="option.value"
              class="tag tag-clickable"
              :class="{ 'tag-active': prompts.activeCategory === option.value }"
              @click="prompts.activeCategory = option.value"
            >
              {{ option.label }}
            </button>
          </div>
        </div>

        <div v-if="prompts.allTags.length" class="toolbar-row">
          <div class="filter-scroll">
            <button
              v-for="tag in visibleTags"
              :key="tag"
              class="tag tag-clickable"
              :class="{ 'tag-active': prompts.activeTag === tag }"
              @click="prompts.activeTag = prompts.activeTag === tag ? '' : tag"
            >
              #{{ tag }}
            </button>
            <button v-if="hiddenTagCount" class="tag tag-clickable" @click="tagExpanded = !tagExpanded">
              {{ tagExpanded ? t("prompts.filter.collapseTags") : t("prompts.filter.moreTags", { count: hiddenTagCount }) }}
            </button>
          </div>
          <button
            v-if="prompts.keyword || prompts.activeCategory || prompts.activeTag || prompts.onlyFavorite || prompts.sourceKind"
            class="link-btn"
            @click="prompts.clearFilters()"
          >
            {{ t("prompts.action.resetFilters") }}
          </button>
        </div>
      </div>

      <!-- 列表 -->
      <div ref="listTop" class="list-anchor" />
      <div v-if="prompts.filtered.length" class="grid" :class="{ 'is-list': viewMode === 'list' }">
        <article v-for="item in visibleItems" :key="item.id" class="pcard card">
          <header class="pcard-head">
            <div class="grow" style="min-width: 0">
              <h3 class="pcard-title t-ellipsis">{{ item.title }}</h3>
              <div class="pcard-meta">
                <span class="tag">{{ categoryLabel(item.category) }}</span>
                <span v-if="item.source === 'builtin'" class="tag tag-brand">{{ t("prompts.source.builtin") }}</span>
                <span v-if="item.source === 'enhanced'" class="tag tag-accent">{{ t("prompts.source.enhanced") }}</span>
                <span v-if="item.source === 'repo'" class="tag tag-info">{{ sourceShortNameOf(item.repo) }}</span>
                <span v-if="item.author" class="t-xs t-faint">@{{ item.author }}</span>
                <span v-else class="t-xs t-faint">{{ formatRelative(item.updatedAt) }}</span>
              </div>
            </div>
            <button
              class="icon-btn"
              :class="{ 'is-active': item.favorite }"
              :title="item.favorite ? t('prompts.action.unfavorite') : t('prompts.action.favorite')"
              @click="prompts.toggleFavorite(item.id)"
            >
              <UiIcon name="star" :size="16" />
            </button>
          </header>

          <button
            v-if="item.images?.length"
            class="pcard-thumb"
            :title="t('prompts.card.thumbTitle')"
            @click="openPreview(item)"
          >
            <RemoteImage :source="item.images[0]" :alt="item.title" />
            <span v-if="item.images.length > 1" class="thumb-badge">{{
              t("prompts.card.imageCount", { count: item.images.length })
            }}</span>
          </button>

          <p class="pcard-content" :class="{ 'clamp-2': viewMode === 'grid' }">{{ item.content }}</p>
          <p v-if="item.negative" class="pcard-negative clamp-2">
            <span class="t-3rd">{{ t("prompts.card.negativeLabel") }}</span>{{ item.negative }}
          </p>

          <div v-if="item.tags.length" class="pcard-tags">
            <span
              v-for="tag in item.tags.slice(0, 4)"
              :key="tag"
              class="tag tag-clickable"
              @click="prompts.activeTag = tag"
            >
              #{{ tag }}
            </span>
          </div>

          <footer class="pcard-foot">
            <span class="t-xs t-faint">
              <UiIcon name="zap" :size="11" />{{ t("prompts.card.usageCount", { count: item.usageCount }) }}
              <span v-if="item.structured"> · {{ t("prompts.card.structuredTag") }}</span>
            </span>
            <span class="row gap-1">
              <button v-if="item.sourceUrl" class="icon-btn" :title="t('prompts.preview.viewSource')" @click="openSource(item)">
                <UiIcon name="link" :size="15" />
              </button>
              <button class="icon-btn" :title="t('common.copy')" @click="copyContent(item)">
                <UiIcon name="copy" :size="15" />
              </button>
              <button class="icon-btn" :title="t('common.edit')" @click="openEdit(item)">
                <UiIcon name="edit" :size="15" />
              </button>
              <button class="icon-btn" :title="t('common.delete')" @click="removeItem(item)">
                <UiIcon name="trash" :size="15" />
              </button>
              <button class="btn btn-sm btn-soft" @click="sendToStudio(item)">
                <UiIcon name="sparkles" :size="13" />{{ t("prompts.action.use") }}
              </button>
            </span>
          </footer>
        </article>
      </div>

      <nav v-if="prompts.filtered.length" class="pager" :aria-label="t('prompts.pager.info', { page, total: totalPages, count: prompts.filtered.length })">
        <span class="pager-info">
          {{ t("prompts.pager.info", { page, total: totalPages, count: prompts.filtered.length }) }}
        </span>
        <span class="pager-buttons">
          <button class="btn btn-sm" :disabled="page <= 1" @click="gotoPage(page - 1)">
            <UiIcon name="chevron-left" :size="14" />{{ t("prompts.pager.prev") }}
          </button>
          <template v-for="(item, index) in pageItems" :key="`${item}-${index}`">
            <span v-if="item === 'gap'" class="pager-gap">…</span>
            <button
              v-else
              class="pager-num"
              :class="{ 'is-active': item === page }"
              @click="gotoPage(item)"
            >
              {{ item }}
            </button>
          </template>
          <button class="btn btn-sm" :disabled="page >= totalPages" @click="gotoPage(page + 1)">
            {{ t("prompts.pager.next") }}<UiIcon name="chevron-right" :size="14" />
          </button>
        </span>
      </nav>

      <UiEmpty
        v-if="!prompts.filtered.length"
        class="card"
        icon="book"
        :title="t('prompts.empty.title')"
        :description="t('prompts.empty.desc')"
      >
        <button class="btn btn-primary btn-sm" @click="repoOpen = true">
          <UiIcon name="cloud" :size="14" />{{ t("prompts.action.pullRepo") }}
        </button>
        <button class="btn btn-sm" @click="prompts.clearFilters()">{{ t("prompts.action.resetFilters") }}</button>
      </UiEmpty>
    </div>

    <PromptEditorModal v-model:open="editorOpen" :item="editing" />
    <PromptRepoModal v-model:open="repoOpen" />
    <PromptPreviewModal
      v-model:open="previewOpen"
      :item="previewItem"
      @copy="copyContent"
      @source="openSource"
      @use="sendToStudio"
    />
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  margin-bottom: 18px;
}
.search-box {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--border-input);
  border-radius: var(--r-sm);
  background: var(--bg-subtle);
  color: var(--text-tertiary);
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.search-box:focus-within {
  border-color: var(--accent);
  background: var(--bg-surface);
}
.search-field {
  flex: 1;
  border: 0;
  background: transparent;
  font-size: var(--fs-13);
}
.search-field:focus {
  outline: none;
}
.toolbar-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}
.filter-scroll {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  flex-wrap: wrap;
  flex: 1;
  min-width: 0;
}
.link-btn {
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--accent);
  font-size: var(--fs-12);
  cursor: pointer;
  white-space: nowrap;
}
.link-btn:hover {
  text-decoration: underline;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 14px;
}
.grid.is-list {
  grid-template-columns: minmax(0, 1fr);
}
.pcard {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
}
.pcard:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-sm);
}
.pcard-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.pcard-title {
  font-size: var(--fs-14);
  font-weight: 650;
  letter-spacing: -0.01em;
}
.pcard-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  flex-wrap: wrap;
}
.pcard-content {
  font-size: var(--fs-12);
  line-height: 1.7;
  color: var(--text-secondary);
  word-break: break-word;
}
.pcard-thumb {
  position: relative;
  display: block;
  width: 100%;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-muted);
  overflow: hidden;
  cursor: zoom-in;
  transition: border-color var(--dur) var(--ease);
}
.pcard-thumb:hover {
  border-color: var(--accent);
}
.pcard-thumb :deep(.remote) {
  aspect-ratio: 4 / 3;
}
.thumb-badge {
  position: absolute;
  right: 7px;
  bottom: 7px;
  padding: 1px 6px;
  border-radius: var(--r-full);
  background: rgba(14, 16, 22, 0.62);
  color: #fff;
  font-size: 10.5px;
  font-weight: 600;
}
.grid.is-list .pcard-thumb :deep(.remote) {
  aspect-ratio: 21 / 9;
}
.pcard-negative {
  font-size: var(--fs-11);
  line-height: 1.6;
  color: var(--text-tertiary);
  padding: 8px 10px;
  border-radius: var(--r-sm);
  background: var(--bg-subtle);
}
.pcard-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.pcard-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.pcard-foot .t-xs {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.load-more {
  display: flex;
  justify-content: center;
  margin-top: 18px;
}
.list-anchor {
  scroll-margin-top: 12px;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  margin-top: 18px;
}
.pager-info {
  font-size: var(--fs-12);
  color: var(--text-tertiary);
}
.pager-buttons {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.pager-num {
  min-width: 30px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: var(--fs-12);
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition: all var(--dur) var(--ease);
}
.pager-num:hover {
  border-color: var(--border-strong);
  color: var(--text);
}
.pager-num.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-soft-fg);
  font-weight: 600;
}
.pager-gap {
  padding: 0 2px;
  color: var(--text-faint);
  font-size: var(--fs-12);
}
</style>

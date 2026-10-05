<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useHistoryStore, MODE_LABEL } from "../stores/history";
import { usePromptStore } from "../stores/prompts";
import { useSettingsStore } from "../stores/settings";
import { useDraftStore } from "../stores/draft";
import { useUiStore } from "../stores/ui";
import { copyText, formatRelative, openExternal } from "../platform/env";
import { studioRoute } from "../router/studio";
import { t } from "../i18n";
import { homeIcons } from "../assets/icons";
import UiIcon from "../components/ui/UiIcon.vue";
import UiSmartImage from "../components/ui/UiSmartImage.vue";
import UiEmpty from "../components/ui/UiEmpty.vue";
import PromptPreviewModal from "../components/prompt/PromptPreviewModal.vue";
import RemoteImage from "../components/prompt/RemoteImage.vue";
import type { PromptItem } from "../types";

const router = useRouter();
const history = useHistoryStore();
const prompts = usePromptStore();
const settings = useSettingsStore();
const draft = useDraftStore();
const ui = useUiStore();

const stats = computed(() => history.stats);

/* ---------------------------------------------------------- 灵感推荐 */

/**
 * 灵感池：优先「带案例图」的条目（仓库案例）。
 * 内置提示词没有配图，拿渐变占位图当封面会被当成图片加载失败（首页一眼就是坏的），
 * 所以一条有图的都没有时改用不带封面的分类卡片，而不是继续画色块。
 */
const imagePool = computed(() => prompts.items.filter((item) => item.images?.length));
const builtinPool = computed(() => prompts.items.filter((item) => item.source === "builtin"));
const hasImageInspiration = computed(() => imagePool.value.length > 0);

/** 进首页随机捞一批，点「换一批」再换；种子固定在同一批上，重渲染不会跳来跳去 */
const shuffleSeed = ref(Math.floor(Math.random() * 1e9));
const INSPIRE_COUNT = 4;

function shuffled<T>(list: T[], seed: number): T[] {
  const out = [...list];
  let state = seed || 1;
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const inspirations = computed(() =>
  shuffled(hasImageInspiration.value ? imagePool.value : builtinPool.value, shuffleSeed.value).slice(
    0,
    INSPIRE_COUNT,
  ),
);

/** 标签跟着当前这几条灵感走：点进去就是对应标签的筛选结果 */
const inspirationTags = computed(() => {
  const tags: string[] = [];
  for (const item of inspirations.value) {
    for (const tag of item.tags) {
      if (!tags.includes(tag)) tags.push(tag);
      if (tags.length >= 5) return tags;
    }
  }
  return tags.length ? tags : prompts.allTags.slice(0, 5);
});

/** 没有案例图时卡片靠分类图标撑识别度 */
const CATEGORY_ICON: Record<string, string> = {
  人像: "heart",
  场景: "compass",
  产品: "bookmark",
  电商: "zap",
  广告: "send",
  海报: "palette",
  插画: "sparkles",
  角色: "eye",
  UI: "grid",
  建筑: "layers",
  概念: "lightbulb",
  社区: "cloud",
  其他: "wand",
};

function categoryIcon(category: string): string {
  return CATEGORY_ICON[category] ?? "wand";
}

const previewOpen = ref(false);
const previewItem = ref<PromptItem | null>(null);

function rerollInspirations() {
  shuffleSeed.value = Math.floor(Math.random() * 1e9);
}

/** 有案例图的先看大图与完整提示词，确认后再去生图；纯提示词没有再看的必要，直接带过去 */
function openInspiration(item: PromptItem) {
  if (!item.images?.length) {
    startText2Img(item);
    return;
  }
  previewItem.value = item;
  previewOpen.value = true;
}

function useInspiration(item: PromptItem) {
  previewOpen.value = false;
  startText2Img(item);
}

async function copyInspiration(item: PromptItem) {
  const ok = await copyText(item.negative ? `${item.content}\n\nNegative: ${item.negative}` : item.content);
  if (!ok) {
    ui.warning(t("common.copyFailed"), t("home.toast.copyFailed"));
    return;
  }
  prompts.markUsed(item.id);
  ui.success(t("home.toast.promptCopied"));
}

async function openInspirationSource(item: PromptItem) {
  const url = item.sourceUrl ?? "";
  const ok = url ? await openExternal(url) : false;
  if (!ok) ui.warning(t("home.toast.noSourceLink"), t("home.toast.noSourceLinkDesc"));
}

/** 从首页进提示词库统一清掉上次的筛选，否则会看到「点了标签却是空列表」 */
function openLibrary(tag = "") {
  prompts.clearFilters();
  if (tag) prompts.activeTag = tag;
  router.push("/prompts");
}

const recentImages = computed(() =>
  history.records
    .flatMap((record) => record.images.map((image) => ({ image, record })))
    .slice(0, 10),
);

/**
 * 统计卡。整个数组放在 `computed` 里：语言一变（`t()` 读的是 ref）就重算，
 * 数字与文案一起跟上。`id` 是稳定 key——用会随语言变的 label 当 key
 * 会让切语言时整排卡片被重建。
 */
const statCards = computed(() => [
  {
    id: "total",
    label: t("home.stat.total"),
    value: stats.value.total,
    unit: t("home.stat.unitTimes"),
    icon: homeIcons.totalGenerated,
  },
  {
    id: "images",
    label: t("home.stat.images"),
    value: stats.value.images,
    unit: t("home.stat.unitImage"),
    icon: homeIcons.producedImages,
  },
  {
    id: "rate",
    label: t("home.stat.rate"),
    value: stats.value.rate,
    unit: "%",
    icon: homeIcons.successRate,
  },
  {
    id: "prompts",
    label: t("home.stat.prompts"),
    value: prompts.items.length,
    unit: t("home.stat.unitPrompt"),
    icon: homeIcons.prompts,
  },
]);

function startText2Img(item?: PromptItem) {
  draft.handoff("text2img", {
    prompt: item?.content ?? "",
    negative: item?.negative ?? "",
    structured: item?.structured ?? null,
    promptId: item?.id ?? "",
    references: [],
  });
  if (item) prompts.markUsed(item.id);
  router.push(studioRoute("text2img"));
}

function openHistory(id?: string) {
  if (id) history.selectedId = id;
  router.push("/history");
}

function reuseRecord(recordId: string) {
  const record = history.records.find((item) => item.id === recordId);
  if (!record) return;
  draft.handoff(record.mode, {
    prompt: record.prompt,
    negative: record.negative,
    structured: record.structured ?? null,
    size: record.params.size ?? settings.state.app.defaultSize,
    count: record.params.count ?? 1,
    fromRecordId: record.id,
  });
  ui.info(t("home.toast.paramsLoaded"), t("home.toast.paramsLoadedDesc"));
  router.push(studioRoute(record.mode));
}
</script>

<template>
  <div class="page">
    <div class="page-inner">
      <!-- 首屏 -->
      <section class="hero">
        <div class="hero-main">
          <h1 class="hero-title">
            {{ t('home.title') }}<span class="t-grad">{{ t('home.titleHighlight') }}</span>
          </h1>
          <p class="hero-sub">{{ t('home.subtitle') }}</p>

          <div class="entry-row">
            <button class="entry-card" @click="startText2Img()">
              <img class="entry-icon" :src="homeIcons.text2img" alt="" />
              <span class="grow" style="min-width: 0">
                <span class="entry-title">{{ t('home.entry.text2img') }}</span>
                <span class="entry-sub">{{ t('home.entry.text2imgSub') }}</span>
              </span>
              <span class="entry-arrow"><UiIcon name="arrow-right" :size="16" /></span>
            </button>

            <button class="entry-card" @click="router.push(studioRoute('img2img'))">
              <img class="entry-icon" :src="homeIcons.img2img" alt="" />
              <span class="grow" style="min-width: 0">
                <span class="entry-title">{{ t('home.entry.img2img') }}</span>
                <span class="entry-sub">{{ t('home.entry.img2imgSub') }}</span>
              </span>
              <span class="entry-arrow"><UiIcon name="arrow-right" :size="16" /></span>
            </button>
          </div>

          <div class="entry-row is-secondary">
            <button class="entry-card is-slim" @click="router.push('/workflow')">
              <img class="entry-icon" :src="homeIcons.workflow" alt="" />
              <span class="grow" style="min-width: 0">
                <span class="entry-title">{{ t('home.entry.workflow') }}</span>
                <span class="entry-sub">{{ t('home.entry.workflowSub') }}</span>
              </span>
              <UiIcon name="chevron-right" :size="15" class="t-faint" />
            </button>
            <button class="entry-card is-slim" @click="router.push('/prompts')">
              <img class="entry-icon" :src="homeIcons.promptLibrary" alt="" />
              <span class="grow" style="min-width: 0">
                <span class="entry-title">{{ t('home.entry.prompts') }}</span>
                <span class="entry-sub">{{ t('home.entry.promptsSub') }}</span>
              </span>
              <UiIcon name="chevron-right" :size="15" class="t-faint" />
            </button>
          </div>
        </div>

        <aside class="inspire">
          <div class="row-between inspire-head">
            <span class="panel-title">{{ t('home.inspire.title') }}</span>
            <span class="row gap-1">
              <button class="icon-btn" :title="t('home.inspire.reroll')" @click="rerollInspirations">
                <UiIcon name="refresh" :size="14" />
              </button>
              <button class="link-btn" @click="openLibrary()">
                {{ t('home.inspire.more') }}<UiIcon name="chevron-right" :size="13" />
              </button>
            </span>
          </div>

          <div class="inspire-row">
            <button
              v-for="item in inspirations"
              :key="item.id"
              class="inspire-item"
              :title="item.images?.length ? t('home.inspire.previewTitle') : t('home.inspire.useTitle')"
              @click="openInspiration(item)"
            >
              <span class="inspire-thumb" :class="{ 'is-blank': !item.images?.length }">
                <RemoteImage v-if="item.images?.length" :source="item.images[0]" :alt="item.title" />
                <template v-else>
                  <UiIcon :name="categoryIcon(item.category)" :size="20" />
                  <!-- 分类名是仓库数据（同时是筛选条件），保持原样不翻译 -->
                  <em class="inspire-thumb-cat">{{ item.category }}</em>
                </template>
              </span>
              <span class="inspire-label t-ellipsis">{{ item.title }}</span>
            </button>
          </div>

          <div v-if="inspirationTags.length" class="inspire-tags">
            <span
              v-for="tag in inspirationTags"
              :key="tag"
              class="tag tag-clickable"
              :title="t('home.tag.viewRelated', { tag })"
              @click="openLibrary(tag)"
            >
              #{{ tag }}
            </span>
          </div>

          <button v-if="!hasImageInspiration && !prompts.repoTotal" class="inspire-hint" @click="openLibrary()">
            <UiIcon name="cloud" :size="12" />
            <span class="grow">{{ t('home.inspire.pullRepo') }}</span>
            <UiIcon name="chevron-right" :size="12" />
          </button>
        </aside>
      </section>

      <!-- 统计 -->
      <section class="stat-row">
        <div v-for="card in statCards" :key="card.id" class="stat-card card">
          <img class="stat-icon" :src="card.icon" alt="" />
          <div>
            <p class="stat-value">
              {{ card.value }}<span v-if="card.unit" class="stat-unit">{{ card.unit }}</span>
            </p>
            <p class="stat-label">{{ card.label }}</p>
          </div>
        </div>
      </section>

      <!-- 最近创作 -->
      <section class="block">
        <div class="row-between block-head">
          <div>
            <h2 class="block-title">{{ t('home.recent.title') }}</h2>
            <p class="block-sub">{{ t('home.recent.subtitle') }}</p>
          </div>
          <button class="btn btn-sm" @click="openHistory()">
            {{ t('home.recent.viewAll') }}<UiIcon name="chevron-right" :size="14" />
          </button>
        </div>

        <div v-if="recentImages.length" class="gallery">
          <button
            v-for="entry in recentImages"
            :key="entry.image.id"
            class="gallery-item media media-hover"
            @click="reuseRecord(entry.record.id)"
          >
            <UiSmartImage :image="entry.image" :icon-size="18" />
            <span class="media-overlay">
              <!-- MODE_LABEL 是枚举映射表（数据），不翻译 -->
              <span class="t-xs" style="opacity: 0.8">{{ MODE_LABEL[entry.record.mode] }} · {{ formatRelative(entry.record.createdAt) }}</span>
              <span class="gallery-prompt t-ellipsis">{{ entry.record.prompt }}</span>
            </span>
          </button>
        </div>

        <UiEmpty
          v-else
          class="card"
          icon="images"
          :title="t('home.empty.title')"
          :description="t('home.empty.desc')"
        >
          <button class="btn btn-primary btn-sm" @click="startText2Img()">
            <UiIcon name="sparkles" :size="14" />{{ t('home.action.startText2img') }}
          </button>
        </UiEmpty>
      </section>

      <!-- 配置引导 -->
      <section v-if="!settings.hasModelApi" class="notice card">
        <span class="notice-icon"><UiIcon name="key" :size="18" /></span>
        <div class="grow">
          <p class="notice-title">{{ t('home.notice.title') }}</p>
          <p class="notice-sub">{{ t('home.notice.desc') }}</p>
        </div>
        <button class="btn btn-primary" @click="router.push('/settings')">
          {{ t('home.notice.action') }}<UiIcon name="arrow-right" :size="14" />
        </button>
      </section>
    </div>

    <PromptPreviewModal
      v-model:open="previewOpen"
      :item="previewItem"
      @copy="copyInspiration"
      @source="openInspirationSource"
      @use="useInspiration"
    />
  </div>
</template>

<style scoped>
.hero {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(300px, 1fr);
  gap: 18px;
  margin-bottom: 22px;
}
.hero-main {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.hero-title {
  font-size: var(--fs-32);
  font-weight: 750;
  letter-spacing: -0.025em;
  line-height: 1.2;
}
.hero-sub {
  color: var(--text-secondary);
  font-size: var(--fs-14);
  margin-bottom: 18px;
}

.entry-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.entry-row + .entry-row {
  margin-top: 12px;
}
.entry-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  background: var(--bg-surface);
  text-align: left;
  cursor: pointer;
  transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease),
    transform var(--dur) var(--ease);
}
.entry-card:hover {
  border-color: var(--accent);
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}
.entry-card.is-slim {
  padding: 13px 15px;
}
.entry-icon {
  display: block;
  width: 44px;
  height: 44px;
  flex: none;
  object-fit: contain;
  filter: drop-shadow(0 3px 8px rgba(16, 24, 40, 0.14));
}
.is-slim .entry-icon {
  width: 36px;
  height: 36px;
}
.entry-title {
  display: block;
  font-size: var(--fs-14);
  font-weight: 650;
}
.entry-sub {
  display: block;
  font-size: var(--fs-12);
  color: var(--text-tertiary);
}
.entry-arrow {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  flex: none;
  border-radius: 50%;
  background: var(--bg-muted);
  color: var(--text-secondary);
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.entry-card:hover .entry-arrow {
  background: var(--accent);
  color: #fff;
}

.inspire {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  background: var(--bg-surface);
}
.inspire-head {
  gap: 8px;
}
.inspire-head .link-btn {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex: none;
  white-space: nowrap;
}
.inspire-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.inspire-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
}
.inspire-thumb {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  border-radius: var(--r-md);
  overflow: hidden;
  background: var(--bg-muted);
  transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
}
/* 案例图来自 GitHub 直链，方形缩略图裁切更饱满；地址通不了时组件内部会退到镜像与占位图标 */
.inspire-thumb :deep(.remote img) {
  object-fit: cover;
}
/* 没有案例图的条目：不画假封面，用分类图形 + 品牌浅渐变做成「设计过的卡片」 */
.inspire-thumb.is-blank {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  background: var(--brand-grad-soft);
  color: var(--accent);
}
.inspire-thumb-cat {
  font-size: 10px;
  font-style: normal;
  font-weight: 600;
  letter-spacing: 0.06em;
  opacity: 0.88;
}
.inspire-item:hover .inspire-thumb {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}
.inspire-label {
  font-size: var(--fs-11);
  color: var(--text-secondary);
  text-align: center;
}
.inspire-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: auto;
}
.inspire-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 10px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-tertiary);
  font-size: var(--fs-11);
  text-align: left;
  cursor: pointer;
  transition: border-color var(--dur) var(--ease), color var(--dur) var(--ease);
}
.inspire-hint:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.stat-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 26px;
}
.stat-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 15px 16px;
}
.stat-icon {
  display: block;
  width: 38px;
  height: 38px;
  flex: none;
  object-fit: contain;
}
.stat-value {
  font-size: var(--fs-21);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.1;
}
.stat-unit {
  margin-left: 2px;
  font-size: var(--fs-12);
  font-weight: 500;
  color: var(--text-tertiary);
}
.stat-label {
  font-size: var(--fs-12);
  color: var(--text-tertiary);
}

.block-head {
  gap: 16px;
  margin-bottom: 14px;
}
.block-title {
  font-size: var(--fs-18);
  font-weight: 680;
  letter-spacing: -0.015em;
}
.block-sub {
  margin-top: 2px;
  font-size: var(--fs-12);
  color: var(--text-tertiary);
}

.gallery {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: 12px;
}
.gallery-item {
  aspect-ratio: 1;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  cursor: pointer;
}
.gallery-prompt {
  display: block;
  font-size: var(--fs-11);
  line-height: 1.4;
}

.notice {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 26px;
  padding: 16px 18px;
  border-color: var(--accent);
  background: var(--brand-grad-soft);
}
.notice-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  flex: none;
  border-radius: var(--r-md);
  background: var(--bg-surface);
  color: var(--accent);
}
.notice-title {
  font-size: var(--fs-13);
  font-weight: 650;
}
.notice-sub {
  margin-top: 2px;
  font-size: var(--fs-12);
  color: var(--text-secondary);
  line-height: 1.55;
}
</style>

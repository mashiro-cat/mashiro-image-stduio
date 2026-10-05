<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import type { GeneratedImage, GenMode, HistoryRecord } from "../types";
import { useHistoryStore } from "../stores/history";
import { useCollectionsStore } from "../stores/collections";
import { usePromptStore } from "../stores/prompts";
import { useDraftStore } from "../stores/draft";
import { useUiStore } from "../stores/ui";
import { useUpscaleStore } from "../stores/upscale";
import { useWorkbenchActions } from "../composables/useWorkbenchActions";
import { copyText, formatDuration, formatTime } from "../platform/env";
import { downloadImage } from "../platform/media";
import { revealInFolder } from "../platform/storage";
import { studioRoute } from "../router/studio";
import { t } from "../i18n";
import UiIcon from "../components/ui/UiIcon.vue";
import UiEmpty from "../components/ui/UiEmpty.vue";
import UiSmartImage from "../components/ui/UiSmartImage.vue";
import UiDrawer from "../components/ui/UiDrawer.vue";
import UiModal from "../components/ui/UiModal.vue";
import UiSegmented from "../components/ui/UiSegmented.vue";
import UiTagInput from "../components/ui/UiTagInput.vue";
import UiImageViewer from "../components/ui/UiImageViewer.vue";
import EnhanceResult from "../components/workbench/EnhanceResult.vue";
import AlbumRail from "../components/history/AlbumRail.vue";

const router = useRouter();
const history = useHistoryStore();
const collections = useCollectionsStore();
const prompts = usePromptStore();
const draft = useDraftStore();
const ui = useUiStore();
const upscale = useUpscaleStore();

/**
 * 反推用的是工作台那套「候选 → 采纳」流程：这里只借它的状态与动作，
 * 采纳后写入 draft 再跳到对应工作台，和「复用参数」是同一条交接路径。
 */
const {
  enhancing: reversing,
  enhanceResult,
  enhanceKind,
  reverseFromImages,
  reverseFromRecord,
  applyEnhance,
  discardEnhance,
  resetEnhance,
} = useWorkbenchActions();

const detailOpen = ref(false);
/** 大图查看器：独立于详情抽屉，可从卡片或详情里打开 */
const viewerOpen = ref(false);
const viewerIndex = ref(0);

function openViewer(record: HistoryRecord, index: number) {
  history.selectedId = record.id;
  viewerIndex.value = index;
  viewerOpen.value = true;
}

const modeOptions = computed(() => [
  { label: t("history.filter.mode.all"), value: "" },
  { label: t("history.mode.text2img"), value: "text2img" },
  { label: t("history.mode.img2img"), value: "img2img" },
  { label: t("history.mode.workflow"), value: "workflow" },
]);

const statusOptions = computed(() => [
  { label: t("history.filter.status.all"), value: "" },
  { label: t("history.status.success"), value: "success" },
  { label: t("history.status.failed"), value: "failed" },
  { label: t("history.status.running"), value: "running" },
]);

/** GenMode 枚举的展示名：磁盘上存的是 text2img/img2img，译文只在渲染期查表 */
function modeLabel(mode: GenMode): string {
  return t(`history.mode.${mode}`);
}

const selected = computed(() => history.selected);

/** 大图查看器的补充信息（模式 + 生成时间） */
const viewerMeta = computed(() => {
  const record = selected.value;
  return record ? `${modeLabel(record.mode)} · ${formatTime(record.createdAt)}` : "";
});

function openDetail(record: HistoryRecord) {
  history.selectedId = record.id;
  // 换记录时清掉上一条的反推结果，避免结果与当前记录对不上
  resetEnhance();
  detailOpen.value = true;
}

/* ------------------------------------------------------------ 提示词反推 */

/** 记录里有图就「看图写词」，没有图就退回按参数复盘 */
async function reverseRecord(record: HistoryRecord) {
  const images = record.images.filter((image) => Boolean(image.path || image.url || image.dataUrl));
  if (images.length) await reverseFromImages(images);
  else await reverseFromRecord(record);
}

/** 采纳反推结果：写入工作台草稿并跳过去（与「复用参数」同一条交接路径） */
function applyReverse(record: HistoryRecord) {
  applyEnhance();
  detailOpen.value = false;
  router.push(studioRoute(record.mode));
}

/* ------------------------------------------------------------ 标签筛选 */

const TAG_LIMIT = 18;
const tagExpanded = ref(false);

const visibleTags = computed(() =>
  tagExpanded.value ? history.allTags : history.allTags.slice(0, TAG_LIMIT),
);
const hiddenTagCount = computed(() => Math.max(0, history.allTags.length - TAG_LIMIT));

function toggleTag(tag: string) {
  history.tagFilter = history.tagFilter === tag ? "" : tag;
}

/* ------------------------------------------------------------ 批量操作 */

/** 批量模式下点卡片是「选中」，不打开详情——否则每选一条都会被抽屉挡住 */
function onCardClick(record: HistoryRecord) {
  if (history.batchMode) {
    history.toggleSelect(record.id);
    return;
  }
  openDetail(record);
}

const allFilteredSelected = computed(
  () => history.filtered.length > 0 && history.filtered.every((record) => history.isSelected(record.id)),
);

function toggleSelectAll() {
  if (allFilteredSelected.value) history.clearSelection();
  else history.selectMany(history.filtered.map((record) => record.id));
}

/* 加入相册 */
const collectionPickOpen = ref(false);
const targetCollectionId = ref("");

function openCollectionPick() {
  // 默认选中当前所在相册，批量整理时通常就是往这里放
  targetCollectionId.value = collections.activeId === "" ? "" : collections.activeId;
  collectionPickOpen.value = true;
}

function confirmAssignCollection() {
  const count = history.assignCollection(history.selectedIds, targetCollectionId.value);
  collectionPickOpen.value = false;
  const name = targetCollectionId.value ? collections.nameOf(targetCollectionId.value) : "";
  // 「已归入「x」」没有对应词条，用「确认归入」+ 相册名兜底（见回报清单）
  ui.success(
    t("history.album.pickConfirm"),
    `${t("history.msg.assigned.desc", { count })} · ${t("history.msg.nameDetail", { name: name || t("history.album.unsorted") })}`,
  );
}

/* 加标签 */
const tagPickOpen = ref(false);
const tagDraft = ref("");

function openTagPick() {
  // 沿用上一次输入的标签，连续整理时不用重复打字
  tagPickOpen.value = true;
}

function confirmAddTag() {
  const tag = tagDraft.value.trim();
  if (!tag) return;
  const count = history.addTagTo(history.selectedIds, tag);
  tagPickOpen.value = false;
  tagDraft.value = "";
  ui.success(t("history.msg.tagAdded", { tag }), t("history.msg.assigned.desc", { count }));
}

async function batchDelete() {
  const count = history.selectedIds.length;
  if (!count) return;
  const ok = await ui.confirm({
    title: t("history.confirm.deleteMany.title", { count }),
    message: t("history.confirm.deleteMany.desc"),
    confirmText: t("history.confirm.deleteMany.action", { count }),
    tone: "danger",
  });
  if (!ok) return;
  const removed = history.removeMany(history.selectedIds);
  ui.success(t("history.msg.recordsDeleted"), t("history.msg.deletedCount", { count: removed }));
}

/* 详情里的标签与相册 */

const detailTags = computed({
  get: () => selected.value?.tags ?? [],
  set: (tags: string[]) => {
    if (selected.value) history.setTags(selected.value.id, tags);
  },
});

const detailCollection = computed({
  get: () => selected.value?.collectionId ?? "",
  set: (value: string) => {
    if (selected.value) history.assignCollection([selected.value.id], value);
  },
});

function coverOf(record: HistoryRecord): GeneratedImage | null {
  return record.images[0] ?? null;
}

function statusLabel(record: HistoryRecord) {
  if (record.status === "success") return { text: t("history.status.success"), cls: "tag-success" };
  if (record.status === "failed") return { text: t("history.status.failed"), cls: "tag-danger" };
  if (record.status === "canceled") return { text: t("history.status.canceled"), cls: "tag" };
  return { text: t("history.status.running"), cls: "tag-warning" };
}

function reuse(record: HistoryRecord) {
  draft.handoff(record.mode, {
    prompt: record.prompt,
    negative: record.negative,
    structured: record.structured ?? null,
    size: record.params.size ?? draft.draft.size,
    count: record.params.count ?? 1,
    quality: record.params.quality ?? draft.draft.quality,
    fromRecordId: record.id,
    references: [],
  });
  detailOpen.value = false;
  ui.info(t("history.msg.reuseLoaded"), t("history.msg.reuseLoaded.desc"));
  router.push(studioRoute(record.mode));
}

function saveAsPrompt(record: HistoryRecord) {
  const item = prompts.saveFromContent(record.prompt, {
    negative: record.negative,
    structured: record.structured,
    title: record.prompt.slice(0, 18) || t("prompts.default.fromHistory"),
  });
  ui.success(t("history.msg.savedToLibrary"), t("history.msg.savedToLibrary.desc", { title: item.title }));
}

async function copyPrompt(record: HistoryRecord) {
  const ok = await copyText(record.prompt);
  if (ok) ui.success(t("history.msg.promptCopied"));
  else ui.warning(t("history.msg.copyFailed"));
}

async function download(image: GeneratedImage, record: HistoryRecord) {
  const saved = await downloadImage(image, `mashiro_${record.id}_${image.id}.png`);
  if (saved) ui.success(t("history.msg.imageSaved"), saved);
  else ui.error(t("history.msg.saveFailed.title"), t("history.msg.saveFailed.desc"));
}

async function reveal(image: GeneratedImage) {
  if (!image.path) {
    ui.warning(t("history.msg.notSaved.title"), t("history.msg.notSaved.desc"));
    return;
  }
  const res = await revealInFolder(image.path);
  if (res.ok) ui.success(t("history.msg.revealed"));
  else ui.warning(t("history.msg.revealFailed.title"), res.error ?? t("history.msg.revealFailed.desc"));
}

/**
 * 送去超分：把图交给超分页排队并跳转。
 *
 * 走 `upscale.openWith()` 而不是 `draft.handoff()`——超分的输入不是提示词，
 * 而且它需要自己的队列通道（那里说明了为什么不能塞进 draft）。
 *
 * 没下模型也允许送：超分页会显示「去下载模型」的空状态，
 * 在这里就拦下会让用户以为是 bug。
 */
async function sendToUpscale(image: GeneratedImage) {
  if (!image.path) {
    ui.warning(t("history.msg.notSaved.title"), t("history.msg.notSavedUpscaleDesc"));
    return;
  }
  upscale.openWith(image);
  // 跟「复用参数」一样把抽屉关掉：跳转后它还开着会挡住新页面
  detailOpen.value = false;
  viewerOpen.value = false;
  await router.push("/upscale");
}

/** 卡片上的快捷入口：定位该条记录的首张图片 */
async function revealCover(record: HistoryRecord) {
  const image = coverOf(record);
  if (!image) {
    ui.warning(t("history.msg.noImagesInRecord"));
    return;
  }
  await reveal(image);
}

async function removeRecord(record: HistoryRecord) {
  const ok = await ui.confirm({
    title: t("history.confirm.deleteOne.title"),
    message: t("history.confirm.deleteOne.desc"),
    confirmText: t("history.confirm.deleteOne.action"),
    tone: "danger",
  });
  if (!ok) return;
  history.remove(record.id);
  detailOpen.value = false;
  ui.success(t("history.msg.deleted"));
}

async function clearAll() {
  const ok = await ui.confirm({
    title: t("history.confirm.clearAll.title"),
    message: t("history.confirm.clearAll.desc", { count: history.stats.total }),
    confirmText: t("history.confirm.clearAll.action"),
    tone: "danger",
  });
  if (!ok) return;
  history.clearAll();
  ui.success(t("history.msg.clearedAll"));
}

async function clearFailed() {
  const ok = await ui.confirm({
    title: t("history.confirm.clearFailed.title"),
    message: t("history.confirm.clearFailed.desc"),
    confirmText: t("history.confirm.clearFailed.action"),
  });
  if (!ok) return;
  const count = history.clearFailed();
  ui.success(t("history.msg.cleared"), t("history.msg.clearedFailedCount", { count }));
}
</script>

<template>
  <div class="page">
    <div class="page-inner">
      <div class="page-head">
        <div>
          <h1 class="page-title">{{ t('history.title') }}</h1>
          <p class="page-sub">
            {{ t('history.stats', { total: history.stats.total, images: history.stats.images, rate: history.stats.rate }) }}
          </p>
        </div>
        <div class="row gap-2">
          <button class="btn" :class="{ 'btn-primary': history.batchMode }" @click="history.batchMode = !history.batchMode">
            <UiIcon name="check-square" :size="15" />{{ history.batchMode ? t('history.batch.exit') : t('history.batch.enter') }}
          </button>
          <button class="btn" @click="clearFailed">
            <UiIcon name="refresh" :size="15" />{{ t('history.action.clearFailed') }}
          </button>
          <button class="btn btn-danger" @click="clearAll">
            <UiIcon name="trash" :size="15" />{{ t('history.action.clearAll') }}
          </button>
        </div>
      </div>

      <div class="history-layout">
        <AlbumRail />

        <div class="history-main">
          <div class="toolbar card">
        <div class="search-box">
          <UiIcon name="search" :size="15" />
          <input v-model="history.keyword" class="search-field" :placeholder="t('history.filter.searchPlaceholder')" />
          <button v-if="history.keyword" class="icon-btn" :title="t('common.reset')" @click="history.keyword = ''">
            <UiIcon name="close" :size="14" />
          </button>
        </div>
        <div class="toolbar-row">
          <UiSegmented v-model="history.modeFilter" :options="modeOptions" />
          <div class="row gap-2">
            <select v-model="history.statusFilter" class="select" style="width: 128px">
              <option v-for="option in statusOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
            <button
              class="tag tag-clickable"
              :class="{ 'tag-active': history.onlyFavorite }"
              @click="history.onlyFavorite = !history.onlyFavorite"
            >
              <UiIcon name="star" :size="11" />{{ t('history.filter.onlyFavorite') }}
            </button>
            <button
              v-if="
                history.keyword ||
                history.modeFilter ||
                history.statusFilter ||
                history.onlyFavorite ||
                history.tagFilter ||
                collections.activeId
              "
              class="link-btn"
              @click="history.clearFilters()"
            >
              {{ t('history.action.resetFilters') }}
            </button>
          </div>
        </div>

        <!-- 标签筛选：按频次取前 N 个，其余收进「+N」 -->
        <div v-if="history.allTags.length" class="tag-row">
          <span class="t-xs t-3rd">{{ t('history.filter.tagsLabel') }}</span>
          <button
            v-for="item in visibleTags"
            :key="item.tag"
            class="tag tag-clickable"
            :class="{ 'tag-active': history.tagFilter === item.tag }"
            @click="toggleTag(item.tag)"
          >
            {{ item.tag }}<span class="tag-n">{{ item.count }}</span>
          </button>
          <button v-if="hiddenTagCount" class="tag tag-clickable" @click="tagExpanded = !tagExpanded">
            {{ tagExpanded ? t('history.filter.collapseTags') : `+${hiddenTagCount}` }}
          </button>
        </div>
      </div>

      <!-- 批量工具条：只对选中项生效，不选中时按钮禁用 -->
      <div v-if="history.batchMode" class="batch-bar card">
        <button class="btn btn-sm" @click="toggleSelectAll">
          <UiIcon :name="allFilteredSelected ? 'check-square' : 'square'" :size="14" />
          {{ allFilteredSelected ? t('history.batch.deselectAll') : t('history.batch.selectAll') }}
        </button>
        <span class="t-sm t-3rd">
          {{ t('history.filter.selectedCount', { selected: history.selectedIds.length, total: history.filtered.length }) }}
        </span>
        <span class="grow" />
        <button class="btn btn-sm" :disabled="!history.selectedIds.length" @click="openCollectionPick">
          <UiIcon name="folder" :size="14" />{{ t('history.batch.addToAlbum') }}
        </button>
        <button class="btn btn-sm" :disabled="!history.selectedIds.length" @click="openTagPick">
          <UiIcon name="tag" :size="14" />{{ t('history.batch.addTag') }}
        </button>
        <button class="btn btn-sm btn-danger" :disabled="!history.selectedIds.length" @click="batchDelete">
          <UiIcon name="trash" :size="14" />{{ t('common.delete') }}
        </button>
      </div>

      <template v-if="history.grouped.length">
        <section v-for="group in history.grouped" :key="group.date" class="day-group">
          <header class="day-head">
            <span class="day-date">{{ group.date }}</span>
            <span class="day-count">{{ t('history.filter.dayCount', { count: group.items.length }) }}</span>
          </header>
          <div class="grid">
            <article
              v-for="record in group.items"
              :key="record.id"
              class="rcard card"
              :class="{ 'is-selected': history.batchMode && history.isSelected(record.id) }"
              @click="onCardClick(record)"
            >
              <div class="rcard-cover media">
                <!-- 卡片展示 512，但预热 1024（灯箱用的尺寸）：
                     用户滚到这张卡时后台就生成好，点「查看大图」时不用等现解码 -->
                <UiSmartImage
                  v-if="coverOf(record)"
                  :image="coverOf(record)"
                  :icon-size="20"
                  :warm-edge="1024"
                />
                <div v-else class="rcard-cover-empty">
                  <UiIcon :name="record.status === 'failed' ? 'alert' : 'sparkles'" :size="20" />
                </div>
                <span v-if="history.batchMode" class="rcard-check">
                  <UiIcon :name="history.isSelected(record.id) ? 'check-square' : 'square'" :size="20" />
                </span>
                <span class="rcard-status tag" :class="statusLabel(record).cls">{{ statusLabel(record).text }}</span>
                <span v-if="record.images.length > 1" class="rcard-count">×{{ record.images.length }}</span>
                <div v-if="!history.batchMode" class="rcard-actions">
                  <button
                    class="icon-btn is-float"
                    :title="t('history.detail.viewLarge')"
                    @click.stop="openViewer(record, 0)"
                  >
                    <UiIcon name="maximize" :size="14" />
                  </button>
                  <button
                    class="icon-btn is-float"
                    :class="{ 'is-active': record.favorite }"
                    :title="t('history.action.favorite')"
                    @click.stop="history.toggleFavorite(record.id)"
                  >
                    <UiIcon name="star" :size="14" />
                  </button>
                  <button class="icon-btn is-float" :title="t('history.action.reuse')" @click.stop="reuse(record)">
                    <UiIcon name="refresh" :size="14" />
                  </button>
                  <button
                    v-if="coverOf(record)?.path && upscale.entryVisible"
                    class="icon-btn is-float"
                    :title="t('history.action.sendToUpscale')"
                    @click.stop="sendToUpscale(coverOf(record)!)"
                  >
                    <UiIcon name="crop" :size="14" />
                  </button>
                  <button class="icon-btn is-float" :title="t('history.action.reveal')" @click.stop="revealCover(record)">
                    <UiIcon name="folder-open" :size="14" />
                  </button>
                  <button class="icon-btn is-float" :title="t('common.delete')" @click.stop="removeRecord(record)">
                    <UiIcon name="trash" :size="14" />
                  </button>
                </div>
              </div>

              <div class="rcard-body">
                <p class="rcard-prompt clamp-2">{{ record.prompt || t('history.detail.noPromptOnCard') }}</p>
                <div v-if="record.tags?.length" class="rcard-tags">
                  <span v-for="tag in record.tags.slice(0, 3)" :key="tag" class="tag">{{ tag }}</span>
                  <span v-if="record.tags.length > 3" class="tag">+{{ record.tags.length - 3 }}</span>
                </div>
                <div class="rcard-meta">
                  <span class="tag tag-accent">{{ modeLabel(record.mode) }}</span>
                  <span class="t-xs t-3rd">{{ record.params.model || record.workflowName }}</span>
                  <span class="t-xs t-faint">{{ formatTime(record.createdAt) }}</span>
                </div>
              </div>
            </article>
          </div>
        </section>
      </template>

      <UiEmpty
        v-else
        class="card"
        icon="history"
        :title="t('history.empty.title')"
        :description="t('history.empty.desc')"
      >
        <button class="btn btn-primary btn-sm" @click="router.push(studioRoute('text2img'))">
          <UiIcon name="sparkles" :size="14" />{{ t('history.action.startText2img') }}
        </button>
        <button class="btn btn-sm" @click="history.clearFilters()">{{ t('history.action.resetFilters') }}</button>
      </UiEmpty>
        </div>
      </div>
    </div>

    <!-- 批量：加入相册 -->
    <UiModal
      v-model:open="collectionPickOpen"
      :title="t('history.album.pickTitle')"
      :description="t('history.album.pickDesc', { count: history.selectedIds.length })"
      :width="440"
    >
      <div class="pick-list">
        <button
          class="pick-item"
          :class="{ 'is-active': targetCollectionId === '' }"
          @click="targetCollectionId = ''"
        >
          <UiIcon name="image" :size="15" />
          <span class="grow">{{ t('history.album.pickUnassigned') }}</span>
          <UiIcon v-if="targetCollectionId === ''" name="check" :size="15" />
        </button>
        <button
          v-for="item in collections.items"
          :key="item.id"
          class="pick-item"
          :class="{ 'is-active': targetCollectionId === item.id }"
          @click="targetCollectionId = item.id"
        >
          <UiIcon name="folder" :size="15" />
          <span class="grow t-ellipsis">{{ item.name }}</span>
          <span class="t-xs t-faint">{{ history.collectionCounts.get(item.id) ?? 0 }}</span>
          <UiIcon v-if="targetCollectionId === item.id" name="check" :size="15" />
        </button>
      </div>
      <p class="field-hint">{{ t('history.album.pickHint') }}</p>
      <template #footer>
        <button class="btn" @click="collectionPickOpen = false">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="!history.selectedIds.length" @click="confirmAssignCollection">
          <UiIcon name="check" :size="15" />{{ t('history.album.pickConfirm') }}
        </button>
      </template>
    </UiModal>

    <!-- 批量：加标签 -->
    <UiModal
      v-model:open="tagPickOpen"
      :title="t('history.tag.pickTitle')"
      :description="t('history.tag.pickDesc', { count: history.selectedIds.length })"
      :width="440"
    >
      <label class="field">
        <span class="field-label">{{ t('history.filter.tagsLabel') }}</span>
        <input
          v-model="tagDraft"
          class="input"
          :placeholder="t('history.tag.placeholder')"
          @keydown.enter="confirmAddTag"
        />
        <span class="field-hint">{{ t('history.tag.hint') }}</span>
      </label>
      <div v-if="history.allTags.length" class="tag-row is-plain">
        <button
          v-for="item in visibleTags"
          :key="item.tag"
          class="tag tag-clickable"
          :class="{ 'tag-active': tagDraft === item.tag }"
          @click="tagDraft = item.tag"
        >
          {{ item.tag }}<span class="tag-n">{{ item.count }}</span>
        </button>
      </div>
      <template #footer>
        <button class="btn" @click="tagPickOpen = false">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="!tagDraft.trim()" @click="confirmAddTag">
          <UiIcon name="tag" :size="15" />{{ t('history.tag.add') }}
        </button>
      </template>
    </UiModal>

    <!-- 详情 -->
    <UiDrawer
      v-model:open="detailOpen"
      :width="520"
      :title="selected ? t('history.detail.titleWithMode', { mode: modeLabel(selected.mode) }) : t('history.detail.title')"
      :subtitle="selected ? formatTime(selected.createdAt) : ''"
    >
      <div v-if="selected" class="detail">
        <div class="detail-images">
          <div
            v-for="(image, index) in selected.images"
            :key="image.id"
            class="detail-image"
            :title="t('history.detail.clickToEnlarge')"
            @click="openViewer(selected, index)"
          >
            <UiSmartImage :image="image" :icon-size="22" :thumb-edge="640" :warm-edge="1024" />
            <div class="detail-image-actions">
              <button class="icon-btn is-float" :title="t('history.detail.viewLarge')" @click.stop="openViewer(selected, index)">
                <UiIcon name="maximize" :size="14" />
              </button>
              <button
                v-if="image.path && upscale.entryVisible"
                class="icon-btn is-float"
                :title="t('history.action.sendToUpscaleShort')"
                @click.stop="sendToUpscale(image)"
              >
                <UiIcon name="crop" :size="14" />
              </button>
              <button class="icon-btn is-float" :title="t('common.download')" @click.stop="download(image, selected)">
                <UiIcon name="download" :size="14" />
              </button>
              <button class="icon-btn is-float" :title="t('history.action.openFolder')" @click.stop="reveal(image)">
                <UiIcon name="folder-open" :size="14" />
              </button>
            </div>
          </div>
          <div v-if="!selected.images.length" class="detail-empty">
            <UiIcon :name="selected.status === 'failed' ? 'alert' : 'image'" :size="22" />
            <p class="t-sm t-3rd">
              {{ selected.status === "failed" ? t('history.detail.failedNoImages') : t('history.detail.noImages') }}
            </p>
          </div>
        </div>

        <section class="detail-block">
          <div class="row-between">
            <span class="panel-title">{{ t('history.detail.promptLabel') }}</span>
            <button class="link-btn" @click="copyPrompt(selected)">
              <UiIcon name="copy" :size="12" />{{ t('common.copy') }}
            </button>
          </div>
          <p class="detail-prompt">{{ selected.prompt || t('history.detail.promptEmpty') }}</p>
          <p v-if="selected.negative" class="detail-negative">
            <span class="t-3rd">{{ t('history.detail.negativeLabel') }}</span>{{ selected.negative }}
          </p>
        </section>

        <section class="detail-block">
          <div class="row-between">
            <span class="panel-title">{{ t('history.reverse.sectionTitle') }}</span>
            <button class="link-btn" :disabled="reversing" @click="reverseRecord(selected)">
              <UiIcon :name="reversing ? 'loader' : 'wand'" :size="12" :class="{ spin: reversing }" />
              {{ reversing ? t('history.reverse.running') : t('history.reverse.run') }}
            </button>
          </div>
          <EnhanceResult
            v-if="enhanceKind === 'reverse' && enhanceResult"
            :prompt="enhanceResult.prompt"
            :variant="enhanceKind"
            :negative="enhanceResult.negative"
            :structured="enhanceResult.structured"
            :notes="enhanceResult.notes"
            @apply="applyReverse(selected)"
            @discard="discardEnhance()"
          />
          <p v-else class="field-hint">
            {{
              selected.images.length
                ? t('history.reverse.hintWithImages')
                : t('history.reverse.hintNoImages')
            }}
          </p>
        </section>

        <section v-if="selected.structured" class="detail-block">
          <span class="panel-title">{{ t('history.detail.structured') }}</span>
          <div class="chip-row">
            <span v-for="(value, key) in selected.structured" :key="key" class="chip">
              <span class="chip-k">{{ key }}</span>
              <span class="chip-v">{{ value || "—" }}</span>
            </span>
          </div>
        </section>

        <section class="detail-block">
          <span class="panel-title">{{ t('history.detail.organize') }}</span>
          <div class="field">
            <span class="field-label">{{ t('history.detail.albumLabel') }}</span>
            <select v-model="detailCollection" class="select">
              <option value="">{{ t('history.album.unsorted') }}</option>
              <option v-for="item in collections.items" :key="item.id" :value="item.id">{{ item.name }}</option>
            </select>
          </div>
          <div class="field">
            <span class="field-label">{{ t('history.detail.tagLabel') }}</span>
            <UiTagInput
              v-model="detailTags"
              :suggestions="history.allTags.map((item) => item.tag)"
              :placeholder="t('history.detail.tagPlaceholder')"
            />
          </div>
        </section>

        <section class="detail-block">
          <span class="panel-title">{{ t('history.detail.paramsLabel') }}</span>
          <dl class="kv">
            <template v-for="(value, key) in selected.params" :key="key">
              <dt>{{ key }}</dt>
              <dd>{{ value ?? "—" }}</dd>
            </template>
            <dt>{{ t('history.detail.durationLabel') }}</dt>
            <dd>{{ formatDuration(selected.durationMs) }}</dd>
            <dt v-if="selected.taskId">{{ t('history.detail.taskIdLabel') }}</dt>
            <dd v-if="selected.taskId" class="t-mono">{{ selected.taskId }}</dd>
            <dt v-if="selected.workflowName">{{ t('history.detail.workflowLabel') }}</dt>
            <dd v-if="selected.workflowName">{{ selected.workflowName }}</dd>
          </dl>
        </section>

        <section v-if="selected.error" class="detail-block">
          <span class="panel-title">{{ t('history.detail.failReason') }}</span>
          <p class="detail-error">{{ selected.error }}</p>
        </section>
      </div>

      <template #footer>
        <button class="btn grow" @click="selected && saveAsPrompt(selected)">
          <UiIcon name="bookmark" :size="15" />{{ t('history.action.saveToLibrary') }}
        </button>
        <button class="btn btn-primary grow" @click="selected && reuse(selected)">
          <UiIcon name="refresh" :size="15" />{{ t('history.action.reuse') }}
        </button>
      </template>
    </UiDrawer>

    <!-- 大图查看：支持翻页、1:1 原始尺寸、下载与定位 -->
    <UiImageViewer
      v-model:open="viewerOpen"
      v-model:index="viewerIndex"
      :images="selected?.images ?? []"
      :meta="viewerMeta"
    >
      <template #actions="{ image }">
        <button
          v-if="image.path && upscale.entryVisible"
          class="viewer-btn"
          :title="t('history.action.sendToUpscale')"
          @click.stop="sendToUpscale(image)"
        >
          <UiIcon name="crop" :size="16" /><span>{{ t('history.action.upscaleShort') }}</span>
        </button>
        <button class="viewer-btn" :title="t('common.download')" @click.stop="selected && download(image, selected)">
          <UiIcon name="download" :size="16" /><span>{{ t('common.download') }}</span>
        </button>
        <button
          v-if="image.path"
          class="viewer-btn"
          :title="t('history.action.reveal')"
          @click.stop="reveal(image)"
        >
          <UiIcon name="folder-open" :size="16" /><span>{{ t('history.action.locateShort') }}</span>
        </button>
      </template>
    </UiImageViewer>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  margin-bottom: 20px;
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
  flex-wrap: wrap;
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

.day-group + .day-group {
  margin-top: 26px;
}
.day-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.day-date {
  font-size: var(--fs-13);
  font-weight: 650;
  color: var(--text);
}
.day-count {
  font-size: var(--fs-11);
  color: var(--text-faint);
}
.day-head::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--border);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(224px, 1fr));
  gap: 14px;
}
.rcard {
  overflow: hidden;
  cursor: pointer;
  transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease),
    transform var(--dur) var(--ease);
}
.rcard:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}
.rcard-cover {
  position: relative;
  aspect-ratio: 4 / 3;
  border-radius: 0;
  border-bottom: 1px solid var(--border);
}
.rcard-cover-empty {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  color: var(--text-faint);
  background: var(--bg-muted);
}
.rcard-status {
  position: absolute;
  top: 8px;
  left: 8px;
  height: 20px;
  font-size: 10.5px;
  z-index: 2;
}
.rcard-count {
  position: absolute;
  bottom: 8px;
  right: 8px;
  z-index: 2;
  padding: 2px 7px;
  border-radius: var(--r-full);
  background: rgba(12, 14, 20, 0.62);
  color: #fff;
  font-size: 10.5px;
}
.rcard-actions {
  position: absolute;
  inset: auto 6px 6px 6px;
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  opacity: 0;
  transform: translateY(4px);
  transition: opacity var(--dur) var(--ease), transform var(--dur) var(--ease);
}
.rcard:hover .rcard-actions {
  opacity: 1;
  transform: none;
}
.icon-btn.is-float {
  background: rgba(255, 255, 255, 0.92);
  color: var(--text);
  box-shadow: var(--shadow-xs);
}
.icon-btn.is-float:hover {
  background: #fff;
  color: var(--text);
}
.icon-btn.is-float.is-active {
  color: var(--warning);
}
.rcard-body {
  padding: 12px 14px 14px;
}
.rcard-prompt {
  font-size: var(--fs-12);
  line-height: 1.6;
  color: var(--text);
  min-height: 38px;
}
.rcard-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  flex-wrap: wrap;
}

/* 详情 */
.detail {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.detail-images {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.detail-image {
  position: relative;
  aspect-ratio: 1;
  border-radius: var(--r-md);
  overflow: hidden;
  border: 1px solid var(--border);
  cursor: zoom-in;
}
.detail-image-actions {
  position: absolute;
  inset: auto 6px 6px 6px;
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  opacity: 0;
  transition: opacity var(--dur) var(--ease);
}
.detail-image:hover .detail-image-actions {
  opacity: 1;
}
.detail-empty {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 30px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--r-md);
  color: var(--text-faint);
}
.detail-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.detail-prompt {
  padding: 11px 12px;
  border-radius: var(--r-md);
  background: var(--bg-subtle);
  font-size: var(--fs-12);
  line-height: 1.7;
  color: var(--text-secondary);
  word-break: break-word;
}
.detail-negative {
  font-size: var(--fs-11);
  line-height: 1.6;
  color: var(--text-tertiary);
  word-break: break-word;
}
.detail-error {
  padding: 11px 12px;
  border-radius: var(--r-md);
  background: var(--danger-soft);
  color: var(--danger);
  font-size: var(--fs-12);
  line-height: 1.6;
  word-break: break-word;
}
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 9px;
  border-radius: var(--r-full);
  background: var(--bg-muted);
  font-size: var(--fs-11);
  max-width: 100%;
}
.chip-k {
  color: var(--text-faint);
}
.chip-v {
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 180px;
}

/* ------------------------------------------------------------ 相册栏布局 */

.history-layout {
  display: grid;
  grid-template-columns: 210px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
.history-main {
  min-width: 0;
}
@media (max-width: 1080px) {
  .history-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* ------------------------------------------------------------ 标签筛选 */

.tag-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding-top: 4px;
  border-top: 1px solid var(--border);
}
.tag-row.is-plain {
  padding-top: 12px;
  border-top: 0;
}
.tag-n {
  margin-left: 4px;
  opacity: 0.6;
  font-size: 10px;
}

/* ------------------------------------------------------------ 批量工具条 */

.batch-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 11px 14px;
  margin-bottom: 16px;
  border-color: var(--accent);
  background: var(--accent-soft);
}
.batch-count {
  color: var(--accent-soft-fg);
}

/* 卡片选中态：描边 + 右上角勾选框 */
.rcard.is-selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-ring);
}
.rcard-check {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 3;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: var(--r-sm);
  background: rgba(255, 255, 255, 0.92);
  color: var(--text);
  box-shadow: var(--shadow-xs);
}
.rcard.is-selected .rcard-check {
  color: var(--accent);
}
.rcard-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
}

/* ------------------------------------------------------------ 批量弹层 */

.pick-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 320px;
  overflow-y: auto;
}
.pick-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 11px;
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--fs-13);
  text-align: left;
  cursor: pointer;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.pick-item:hover {
  background: var(--bg-subtle);
  color: var(--text);
}
.pick-item.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-soft-fg);
  font-weight: 600;
}
</style>

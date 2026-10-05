<script setup lang="ts">
/**
 * 历史记录的相册栏。
 *
 * 自包含：直接用 history / collections 两个 store，不通过 props 传数据——
 * 它只负责「筛选 + 相册增删改」，与父级的列表渲染没有耦合。
 *
 * 相册**不存封面路径**（封面由相册内首张图片派生），所以这里不参与
 * `history.collectReferencedPaths` 的引用收集，删相册不会影响到任何图片文件。
 */
import { nextTick, ref } from "vue";
import { UNSORTED, useCollectionsStore, type Collection } from "../../stores/collections";
import { useHistoryStore } from "../../stores/history";
import { useUiStore } from "../../stores/ui";
import { t } from "../../i18n";
import UiIcon from "../ui/UiIcon.vue";

const collections = useCollectionsStore();
const history = useHistoryStore();
const ui = useUiStore();

/** 新建相册：展开一个输入行，回车确认（避免用原生 prompt 打断桌面端观感） */
const creating = ref(false);
const draftName = ref("");
const creatingInput = ref<HTMLInputElement | null>(null);

const renamingId = ref("");
const renameValue = ref("");

async function startCreate() {
  creating.value = true;
  draftName.value = "";
  await nextTick();
  creatingInput.value?.focus();
}

function cancelCreate() {
  creating.value = false;
  draftName.value = "";
}

function confirmCreate() {
  const name = draftName.value.trim();
  if (!name) {
    cancelCreate();
    return;
  }
  const item = collections.add(name);
  collections.activeId = item.id;
  cancelCreate();
  ui.success(t("history.msg.albumCreated"), t("history.msg.nameDetail", { name: item.name }));
}

async function startRename(item: Collection) {
  renamingId.value = item.id;
  renameValue.value = item.name;
  await nextTick();
}

function confirmRename() {
  const id = renamingId.value;
  if (!id) return;
  const before = collections.byId(id)?.name ?? "";
  const name = renameValue.value.trim();
  renamingId.value = "";
  if (!name || name === before) return;
  collections.rename(id, name);
  ui.success(t("history.msg.albumRenamed"), t("history.msg.nameDetail", { name: collections.byId(id)?.name ?? name }));
}

async function removeCollection(item: Collection) {
  const count = history.collectionCounts.get(item.id) ?? 0;
  const ok = await ui.confirm({
    title: t("history.confirm.deleteAlbum.title", { name: item.name }),
    message: count
      ? t("history.confirm.deleteAlbum.withCount", { count })
      : t("history.confirm.deleteAlbum.empty"),
    confirmText: t("history.confirm.deleteAlbum.action"),
    tone: "danger",
  });
  if (!ok) return;
  collections.remove(item.id);
  // 相册没了，记录里指向它的 id 必须一并清掉，否则它们既不在相册里、也不在「未归档」里
  history.detachCollection(item.id);
  ui.success(t("common.deleteDone"), t("history.msg.nameDetail", { name: item.name }));
}

/** 切相册时顺带清空批量选中：跨相册的选中集合没有意义，容易误删 */
function select(id: string) {
  if (collections.activeId === id) return;
  collections.activeId = id;
  history.clearSelection();
}
</script>

<template>
  <aside class="album-rail card">
    <div class="rail-head">
      <span class="panel-title">{{ t('history.album.title') }}</span>
      <button class="icon-btn" :title="t('history.album.create')" @click="startCreate">
        <UiIcon name="plus" :size="15" />
      </button>
    </div>

    <div class="rail-list">
      <button class="album-item" :class="{ 'is-active': collections.activeId === '' }" @click="select('')">
        <UiIcon name="history" :size="14" />
        <span class="grow t-ellipsis">{{ t('history.album.all') }}</span>
        <span class="album-count">{{ history.records.length }}</span>
      </button>

      <button
        class="album-item"
        :class="{ 'is-active': collections.activeId === UNSORTED }"
        @click="select(UNSORTED)"
      >
        <UiIcon name="image" :size="14" />
        <span class="grow t-ellipsis">{{ t('history.album.unsorted') }}</span>
        <span class="album-count">{{ history.collectionCounts.get(UNSORTED) ?? 0 }}</span>
      </button>

      <div v-for="item in collections.items" :key="item.id" class="album-row">
        <input
          v-if="renamingId === item.id"
          v-model="renameValue"
          class="input album-rename"
          @keydown.enter="confirmRename"
          @keydown.esc="renamingId = ''"
          @blur="confirmRename"
        />
        <template v-else>
          <button
            class="album-item grow-item"
            :class="{ 'is-active': collections.activeId === item.id }"
            @click="select(item.id)"
          >
            <UiIcon name="folder" :size="14" />
            <span class="grow t-ellipsis">{{ item.name }}</span>
            <span class="album-count">{{ history.collectionCounts.get(item.id) ?? 0 }}</span>
          </button>
          <button class="icon-btn" :title="t('history.album.rename')" @click.stop="startRename(item)">
            <UiIcon name="edit" :size="13" />
          </button>
          <button class="icon-btn" :title="t('history.album.remove')" @click.stop="removeCollection(item)">
            <UiIcon name="trash" :size="13" />
          </button>
        </template>
      </div>

      <div v-if="creating" class="album-row">
        <input
          ref="creatingInput"
          v-model="draftName"
          class="input album-rename"
          :placeholder="t('history.album.namePlaceholder')"
          @keydown.enter="confirmCreate"
          @keydown.esc="cancelCreate"
          @blur="confirmCreate"
        />
      </div>

      <p v-if="!collections.items.length && !creating" class="rail-hint">
        {{ t('history.album.emptyHint') }}
      </p>
    </div>
  </aside>
</template>

<style scoped>
.album-rail {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 12px;
  align-self: start;
  position: sticky;
  top: 12px;
}
.rail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 0 4px;
}
.rail-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.album-row {
  display: flex;
  align-items: center;
  gap: 2px;
}
.album-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 9px;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--fs-12);
  text-align: left;
  cursor: pointer;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.grow-item {
  flex: 1;
  min-width: 0;
}
.album-item:hover {
  background: var(--bg-subtle);
  color: var(--text);
}
.album-item.is-active {
  background: var(--accent-soft);
  color: var(--accent-soft-fg);
  font-weight: 600;
}
.album-count {
  flex: none;
  font-size: var(--fs-11);
  color: var(--text-faint);
}
.album-item.is-active .album-count {
  color: inherit;
  opacity: 0.75;
}
.album-rename {
  width: 100%;
  height: 30px;
  font-size: var(--fs-12);
}
.rail-hint {
  padding: 6px 4px 2px;
  font-size: var(--fs-11);
  line-height: 1.6;
  color: var(--text-faint);
}
</style>

/* ==========================================================================
   相册（历史记录的分组）
   ---------------------------------------------------------------------------
   相册只存「名字」，不存封面路径：
   封面由相册内的首张图片**派生**出来，因此不会给 `history.collectReferencedPaths`
   引入新的图片引用来源——这是刻意的设计，避免删记录时把相册封面删成破图。
   ========================================================================== */

import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import { readJson, writeJson } from "../platform/storage";
import { uid } from "../platform/env";
import { t } from "../i18n";

export interface Collection {
  id: string;
  name: string;
  createdAt: number;
}

/** 历史页「未归档」筛选的虚拟 id，不会出现在相册列表里 */
export const UNSORTED = "__unsorted__";

export const useCollectionsStore = defineStore("collections", () => {
  const items = ref<Collection[]>([]);
  const loaded = ref(false);
  /** 当前筛选的相册："" = 全部，UNSORTED = 未归档，其余为相册 id */
  const activeId = ref("");

  async function load() {
    const saved = await readJson<Collection[]>("collections", []);
    items.value = Array.isArray(saved)
      ? saved
          .map((entry) => ({
            id: String(entry?.id ?? "") || uid("col"),
            name: String(entry?.name ?? "").trim() || t("history.album.defaultName"),
            createdAt: Number(entry?.createdAt) || Date.now(),
          }))
          .filter((entry) => Boolean(entry.name))
      : [];
    loaded.value = true;
  }

  let timer: number | undefined;
  watch(
    items,
    () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(
        () => void writeJson("collections", JSON.parse(JSON.stringify(items.value))),
        300,
      );
    },
    { deep: true },
  );

  const names = computed(() => items.value.map((item) => item.name));
  const byId = (id: string) => items.value.find((item) => item.id === id);
  const nameOf = (id?: string) => (id ? byId(id)?.name ?? "" : "");

  function add(rawName = ""): Collection {
    // 同名相册会让「加入相册」的列表产生歧义，直接补序号
    // 默认名在**调用时**取 t()：模块级常量会在 import 时锁死启动时的语言
    const fallback = t("history.album.title");
    let name = rawName.trim() || t("history.album.autoName", { index: items.value.length + 1 });
    let index = 2;
    while (items.value.some((item) => item.name === name)) {
      name = `${rawName.trim() || fallback} ${index}`;
      index += 1;
    }
    const item: Collection = { id: uid("col"), name, createdAt: Date.now() };
    items.value.push(item);
    return item;
  }

  function rename(id: string, rawName: string) {
    const target = byId(id);
    const name = rawName.trim();
    if (!target || !name) return;
    if (items.value.some((item) => item.id !== id && item.name === name)) return;
    target.name = name;
  }

  /** 删除相册定义。成员记录的 `collectionId` 由调用方（HistoryView）负责清空 */
  function remove(id: string) {
    items.value = items.value.filter((item) => item.id !== id);
    if (activeId.value === id) activeId.value = "";
  }

  /** 相册被删后，记录里指向它的 id 就会变成悬空值，这里统一清理 */
  function resetAll() {
    items.value = [];
    activeId.value = "";
  }

  return {
    items,
    loaded,
    activeId,
    names,
    byId,
    nameOf,
    add,
    rename,
    remove,
    resetAll,
    load,
  };
});

import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type { GenMode, HistoryRecord } from "../types";
import { listDir, readJson, toAbsolutePath, writeJson } from "../platform/storage";
import { uid } from "../platform/env";
import { removeLocalImage } from "../platform/media";
import { t } from "../i18n";
import { useDraftStore } from "./draft";
import { UNSORTED, useCollectionsStore } from "./collections";

/**
 * GenMode 枚举的展示名。
 *
 * ⚠️ **刻意做成 getter 而不是普通对象字面量**：`t()` 读的是语言 ref，
 * 模块加载时求值一次就把语言锁死了，用户切到英文后仍显示「文生图」。
 * 走属性访问器后每次读取都按当前语言查表，调用点（`MODE_LABEL[mode]`）不用改。
 *
 * 磁盘上存的始终是 `text2img`/`img2img`/`workflow` 原始枚举值，译文不写回记录。
 */
export const MODE_LABEL: Record<GenMode, string> = {
  get text2img() {
    return t("history.mode.text2img");
  },
  get img2img() {
    return t("history.mode.img2img");
  },
  get workflow() {
    return t("history.mode.workflow");
  },
};

export function createRecord(patch: Partial<HistoryRecord> = {}): HistoryRecord {
  return {
    id: uid("rec"),
    mode: "text2img",
    provider: "model",
    status: "success",
    prompt: "",
    negative: "",
    params: {},
    images: [],
    favorite: false,
    tags: [],
    createdAt: Date.now(),
    ...patch,
  };
}

export const useHistoryStore = defineStore("history", () => {
  const records = ref<HistoryRecord[]>([]);
  const loaded = ref(false);

  const keyword = ref("");
  const modeFilter = ref<GenMode | "">("");
  const onlyFavorite = ref(false);
  const statusFilter = ref<"" | "success" | "failed" | "running">("");
  const tagFilter = ref("");
  const selectedId = ref("");

  /** 批量模式的选中集合（只在内存里，切页不保留） */
  const batchMode = ref(false);
  const selectedIds = ref<string[]>([]);

  const MAX_RECORDS = 500;

  async function load() {
    const saved = await readJson<HistoryRecord[]>("history", []);
    records.value = Array.isArray(saved) ? saved : [];
    loaded.value = true;
  }

  let timer: number | undefined;
  function persist() {
    window.clearTimeout(timer);
    timer = window.setTimeout(
      () => void writeJson("history", JSON.parse(JSON.stringify(records.value))),
      320,
    );
  }

  function mutate(fn: () => void) {
    fn();
    persist();
  }

  const filtered = computed(() => {
    const text = keyword.value.trim().toLowerCase();
    const collectionId = useCollectionsStore().activeId;
    return records.value.filter((record) => {
      if (modeFilter.value && record.mode !== modeFilter.value) return false;
      if (onlyFavorite.value && !record.favorite) return false;
      if (statusFilter.value && record.status !== statusFilter.value) return false;
      // 相册筛选：「未归档」是虚拟项，其余按 collectionId 精确匹配
      if (collectionId === UNSORTED) {
        if (record.collectionId) return false;
      } else if (collectionId && record.collectionId !== collectionId) {
        return false;
      }
      if (tagFilter.value && !(record.tags ?? []).includes(tagFilter.value)) return false;
      if (!text) return true;
      return (
        record.prompt.toLowerCase().includes(text) ||
        record.negative.toLowerCase().includes(text) ||
        (record.params.model ?? "").toLowerCase().includes(text) ||
        (record.workflowName ?? "").toLowerCase().includes(text) ||
        (record.tags ?? []).some((tag) => tag.toLowerCase().includes(text))
      );
    });
  });

  /** 全部标签 + 出现次数，按频次排序 */
  const allTags = computed(() => {
    const counts = new Map<string, number>();
    records.value.forEach((record) =>
      (record.tags ?? []).forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)),
    );
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag, count]) => ({ tag, count }));
  });

  /** 每个相册的记录数（含「未归档」），相册栏的徽标用 */
  const collectionCounts = computed(() => {
    const map = new Map<string, number>();
    let unsorted = 0;
    for (const record of records.value) {
      if (!record.collectionId) {
        unsorted += 1;
        continue;
      }
      map.set(record.collectionId, (map.get(record.collectionId) ?? 0) + 1);
    }
    map.set(UNSORTED, unsorted);
    return map;
  });

  /** 按日期分组，便于按时间线浏览 */
  const grouped = computed(() => {
    const groups = new Map<string, HistoryRecord[]>();
    for (const record of filtered.value) {
      const date = new Date(record.createdAt);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
        date.getDate(),
      ).padStart(2, "0")}`;
      const list = groups.get(key) ?? [];
      list.push(record);
      groups.set(key, list);
    }
    return Array.from(groups.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([date, items]) => ({ date, items }));
  });

  const stats = computed(() => {
    const total = records.value.length;
    const images = records.value.reduce((sum, record) => sum + record.images.length, 0);
    const success = records.value.filter((record) => record.status === "success").length;
    const rate = total ? Math.round((success / total) * 100) : 0;
    const byMode = {
      text2img: records.value.filter((r) => r.mode === "text2img").length,
      img2img: records.value.filter((r) => r.mode === "img2img").length,
      workflow: records.value.filter((r) => r.mode === "workflow").length,
    };
    return { total, images, success, rate, byMode };
  });

  const selected = computed(() => records.value.find((record) => record.id === selectedId.value));
  const recent = computed(() => records.value.slice(0, 12));

  /**
   * 收集「仍被引用」的图片路径，删除前逐个排除。
   *
   * 一张图可能同时被多处指向，误删会让别处的预览直接变成破图：
   * - 其他记录的 `inputImages`（图生图拿历史图当参考图）
   * - 工作台草稿的参考图 / 工作流图片槽位（`draft` 是持久化的，重启后还在）
   * - 提示词仓库条目的示例图
   *
   * **相册不在这里**：相册只存名字，封面由相册内的首张图片派生（见 stores/collections.ts），
   * 因此没有引入新的引用来源。若将来给相册加上「手动指定封面」，**必须**把封面路径补进这里，
   * 否则删记录时会把封面删成破图。
   */
  function collectReferencedPaths(): Set<string> {
    const used = new Set<string>();
    for (const record of records.value) {
      record.images.forEach((image) => image.path && used.add(image.path));
      record.inputImages?.forEach((path) => path && used.add(path));
    }
    const draftImages = [
      ...useDraftStore().draft.references,
      ...Object.values(useDraftStore().draft.workflowImages),
    ];
    draftImages.forEach((image) => image?.path && used.add(image.path));
    return used;
  }

  /** 真正删掉磁盘文件：跳过仍被别处引用的，避免删出破图 */
  function dropImageFiles(paths: Array<string | undefined>) {
    const stillUsed = collectReferencedPaths();
    for (const path of paths) {
      if (path && !stillUsed.has(path)) void removeLocalImage(path);
    }
  }

  function add(record: HistoryRecord) {
    let dropped: HistoryRecord[] = [];
    mutate(() => {
      records.value.unshift(record);
      if (records.value.length > MAX_RECORDS) {
        // 被截断的记录已经没人能回看了，它留在磁盘上的图片就是纯垃圾。
        // 这里必须连文件一起清——只丢记录会让 images/ 无限膨胀。
        dropped = records.value.slice(MAX_RECORDS);
        records.value = records.value.slice(0, MAX_RECORDS);
      }
    });
    if (dropped.length) {
      dropImageFiles(dropped.flatMap((item) => item.images.map((image) => image.path)));
    }
    return record;
  }

  function update(id: string, patch: Partial<HistoryRecord>) {
    mutate(() => {
      const target = records.value.find((record) => record.id === id);
      if (target) Object.assign(target, patch);
    });
  }

  function toggleFavorite(id: string) {
    const target = records.value.find((record) => record.id === id);
    if (target) update(id, { favorite: !target.favorite });
  }

  function remove(id: string) {
    const target = records.value.find((record) => record.id === id);
    mutate(() => {
      records.value = records.value.filter((record) => record.id !== id);
    });
    if (selectedId.value === id) selectedId.value = "";
    // 先从列表里摘掉再删文件：collectReferencedPaths 只看剩下的记录，
    // 这样「别的记录还在用同一张图」才能被正确识别出来。
    if (target) dropImageFiles(target.images.map((image) => image.path));
    pruneSelection();
  }

  function clearFailed() {
    const removed = records.value.filter((record) => record.status === "failed");
    mutate(() => {
      records.value = records.value.filter((record) => record.status !== "failed");
    });
    dropImageFiles(removed.flatMap((record) => record.images.map((image) => image.path)));
    pruneSelection();
    return removed.length;
  }

  function clearAll() {
    const all = records.value.flatMap((record) => record.images.map((image) => image.path));
    mutate(() => {
      records.value = [];
    });
    selectedId.value = "";
    clearSelection();
    // 清空全部时不再逐个比对引用：此时草稿/提示词库仍可能指向这些图，
    // 但用户已经明确要求「清空」，留下的图由孤儿清理兜底。
    for (const path of all) {
      if (path) void removeLocalImage(path);
    }
  }

  /* ------------------------------------------------------------ 批量与标签 */

  function isSelected(id: string) {
    return selectedIds.value.includes(id);
  }

  /** 选中集合只保留仍然存在的记录，避免删完之后残留幽灵 id */
  function pruneSelection() {
    if (!selectedIds.value.length) return;
    const alive = new Set(records.value.map((record) => record.id));
    selectedIds.value = selectedIds.value.filter((id) => alive.has(id));
  }

  function toggleSelect(id: string) {
    selectedIds.value = isSelected(id)
      ? selectedIds.value.filter((item) => item !== id)
      : [...selectedIds.value, id];
  }

  function selectMany(ids: string[]) {
    selectedIds.value = Array.from(new Set([...selectedIds.value, ...ids]));
  }

  function clearSelection() {
    selectedIds.value = [];
  }

  function exitBatch() {
    batchMode.value = false;
    selectedIds.value = [];
  }

  /**
   * 批量删除。
   * 顺序与单条删除保持一致：**先从 records 里摘掉、再删文件**——
   * `collectReferencedPaths` 只看剩下的记录，反了就会把「别的记录 / 草稿仍在用」的图删掉。
   */
  function removeMany(ids: string[]) {
    if (!ids.length) return 0;
    const wanted = new Set(ids);
    const targets = records.value.filter((record) => wanted.has(record.id));
    if (!targets.length) return 0;
    const paths = targets.flatMap((record) => record.images.map((image) => image.path));

    mutate(() => {
      records.value = records.value.filter((record) => !wanted.has(record.id));
    });
    if (selectedId.value && wanted.has(selectedId.value)) selectedId.value = "";
    dropImageFiles(paths);
    pruneSelection();
    return targets.length;
  }

  /** 把记录归入某个相册（传空串表示移出相册） */
  function assignCollection(ids: string[], collectionId: string) {
    if (!ids.length) return 0;
    const wanted = new Set(ids);
    let count = 0;
    mutate(() => {
      for (const record of records.value) {
        if (!wanted.has(record.id)) continue;
        if (collectionId) record.collectionId = collectionId;
        else delete record.collectionId;
        count += 1;
      }
    });
    return count;
  }

  /** 相册被删除后清掉所有指向它的 collectionId，否则筛选里会留下悬空值 */
  function detachCollection(collectionId: string) {
    mutate(() => {
      for (const record of records.value) {
        if (record.collectionId === collectionId) delete record.collectionId;
      }
    });
  }

  function addTagTo(ids: string[], tag: string) {
    const value = tag.trim();
    if (!ids.length || !value) return 0;
    const wanted = new Set(ids);
    let count = 0;
    mutate(() => {
      for (const record of records.value) {
        if (!wanted.has(record.id)) continue;
        const tags = record.tags ?? [];
        if (tags.includes(value)) continue;
        record.tags = [...tags, value];
        count += 1;
      }
    });
    return count;
  }

  function removeTagFrom(ids: string[], tag: string) {
    const wanted = new Set(ids);
    let count = 0;
    mutate(() => {
      for (const record of records.value) {
        if (!wanted.has(record.id)) continue;
        const tags = record.tags ?? [];
        if (!tags.includes(tag)) continue;
        record.tags = tags.filter((item) => item !== tag);
        count += 1;
      }
    });
    return count;
  }

  /** 记录详情里直接编辑标签 */
  function setTags(id: string, tags: string[]) {
    update(id, { tags });
  }

  function clearFilters() {
    keyword.value = "";
    modeFilter.value = "";
    onlyFavorite.value = false;
    statusFilter.value = "";
    tagFilter.value = "";
    useCollectionsStore().activeId = "";
  }

  /**
   * 清理孤儿图片：磁盘 `images/` 里还在、但已无任何记录引用的文件。
   *
   * 早期版本在历史记录超过上限时只丢记录、不删文件，加上各种异常退出，
   * 目录里会攒下大量没人要的图（本机实测 32 个 / 54MB）。
   * 这里按「文件名」比对——图片文件名带唯一 id，够用且不受路径分隔符差异影响。
   *
   * 返回删除的文件数。
   */
  async function sweepOrphans(): Promise<number> {
    const names = await listDir("images");
    if (!names.length) return 0;

    const stillUsed = collectReferencedPaths();
    // 只留文件名部分：存进历史记录的是绝对路径，list_dir 给的是纯文件名
    const usedNames = new Set<string>();
    for (const path of stillUsed) {
      const name = path.split(/[\\/]+/).pop();
      if (name) usedNames.add(name);
    }

    let removed = 0;
    for (const name of names) {
      if (usedNames.has(name)) continue;
      const absolute = await toAbsolutePath(`images/${name}`);
      if (!absolute) continue;
      await removeLocalImage(absolute);
      removed += 1;
    }
    return removed;
  }

  return {
    records,
    loaded,
    keyword,
    modeFilter,
    onlyFavorite,
    statusFilter,
    tagFilter,
    selectedId,
    batchMode,
    selectedIds,
    selected,
    filtered,
    grouped,
    stats,
    recent,
    allTags,
    collectionCounts,
    load,
    add,
    update,
    toggleFavorite,
    remove,
    removeMany,
    clearFailed,
    clearAll,
    clearFilters,
    isSelected,
    toggleSelect,
    selectMany,
    clearSelection,
    exitBatch,
    assignCollection,
    detachCollection,
    addTagTo,
    removeTagFrom,
    setTags,
    sweepOrphans,
  };
});

import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type { PromptItem } from "../types";
import { readJson, writeJson } from "../platform/storage";
import { uid } from "../platform/env";
import { PROMPT_SOURCES, type RepoPromptEntry } from "../services/promptRepo";

export const PROMPT_CATEGORIES = [
  "人像",
  "场景",
  "产品",
  "电商",
  "广告",
  "海报",
  "插画",
  "角色",
  "UI",
  "建筑",
  "概念",
  "社区",
  "其他",
];

function createItem(patch: Partial<PromptItem> = {}): PromptItem {
  const now = Date.now();
  return {
    id: uid("pmt"),
    title: "未命名提示词",
    content: "",
    negative: "",
    category: "其他",
    tags: [],
    favorite: false,
    usageCount: 0,
    source: "manual",
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

/** 正文归一化，用于识别「同一条提示词」 */
function normalizeContent(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** 内置起始提示词库，保证开箱即用 */
const BUILTIN: Array<Partial<PromptItem>> = [
  {
    title: "东京雨夜街拍人像",
    content:
      "young woman walking on a neon-lit Tokyo street at night, white coat, looking back over shoulder, cinematic lighting, bokeh city lights, 35mm lens, shallow depth of field, film photography, teal and orange grading",
    negative: "lowres, blurry, extra fingers, watermark, oversaturated",
    category: "人像",
    tags: ["夜景", "霓虹", "电影感"],
    source: "builtin",
  },
  {
    title: "极简产品静物",
    content:
      "minimalist product photography of a ceramic coffee cup on a seamless beige backdrop, soft gradient studio light, subtle shadow, commercial quality, high detail, centered composition",
    negative: "clutter, harsh shadow, text, logo, reflection artifacts",
    category: "产品",
    tags: ["白底", "商业", "静物"],
    source: "builtin",
  },
  {
    title: "东方幻想山水",
    content:
      "ethereal eastern fantasy landscape, floating islands above a misty river, ancient pagoda silhouette, cherry blossom petals in the wind, soft dawn light, ink painting meets cinematic render, volumetric fog",
    negative: "low quality, distorted architecture, watermark",
    category: "场景",
    tags: ["国风", "幻想", "大气"],
    source: "builtin",
  },
  {
    title: "赛博朋克街角",
    content:
      "cyberpunk alley at midnight, holographic signage in chinese characters, wet asphalt reflections, steam rising from vents, neon pink and cyan rim light, anamorphic flare, ultra detailed",
    negative: "daylight, clean street, low contrast, blurry",
    category: "场景",
    tags: ["赛博朋克", "霓虹", "夜晚"],
    source: "builtin",
  },
  {
    title: "日系动漫女主特写",
    content:
      "anime girl portrait, soft cel shading, expressive amber eyes, messy silver hair, school uniform with ribbon, cherry petals, gentle rim light, clean line art, studio-quality illustration",
    negative: "extra limbs, bad anatomy, lowres, blurry",
    category: "插画",
    tags: ["动漫", "特写", "日系"],
    source: "builtin",
  },
  {
    title: "3D 卡通角色",
    content:
      "cute 3d cartoon character of a chubby astronaut cat, glossy toy-like material, subsurface scattering, soft studio lighting, pixar style render, centered on pastel background, octane render",
    negative: "realistic fur, scary, dark background, noise",
    category: "插画",
    tags: ["3D", "卡通", "角色"],
    source: "builtin",
  },
  {
    title: "建筑摄影·现代极简",
    content:
      "modern minimalist architecture photography, concrete and glass facade, strong geometric lines, clear blue sky, wide angle 24mm, symmetrical composition, natural daylight, high dynamic range",
    negative: "distorted perspective, people, clutter, lowres",
    category: "建筑",
    tags: ["建筑", "极简", "几何"],
    source: "builtin",
  },
  {
    title: "概念设定·机械载具",
    content:
      "concept art of a heavy armored hover vehicle, weathered metal panels, exposed hydraulic parts, desert dust, dramatic sunset backlight, detailed greebles, artstation trending, cinematic scale",
    negative: "flat shading, low detail, cartoonish, watermark",
    category: "概念",
    tags: ["概念设定", "机械", "硬表面"],
    source: "builtin",
  },
  {
    title: "水彩治愈小景",
    content:
      "watercolor illustration of a cozy countryside cottage in spring, soft color washes, visible paper texture, blooming flower field, warm afternoon light, delicate brush strokes, storybook mood",
    negative: "digital look, harsh outlines, oversaturated, watermark",
    category: "场景",
    tags: ["水彩", "治愈", "插画"],
    source: "builtin",
  },
  {
    title: "杂志质感时尚大片",
    content:
      "high fashion editorial portrait, model in structured avant-garde top, seamless studio backdrop, hard key light with soft fill, glossy skin retouching, 85mm lens, vogue magazine aesthetic",
    negative: "amateur photo, harsh makeup, cluttered background, lowres",
    category: "人像",
    tags: ["时尚", "棚拍", "杂志"],
    source: "builtin",
  },
];

export const usePromptStore = defineStore("prompts", () => {
  const items = ref<PromptItem[]>([]);
  const loaded = ref(false);
  const keyword = ref("");
  const activeCategory = ref("");
  const activeTag = ref("");
  const onlyFavorite = ref(false);
  /** 来源筛选：内置 / 我的 / 仓库，空表示不限 */
  const sourceKind = ref<"" | "builtin" | "mine" | "repo">("");
  /** 具体来源仓库（owner/name），空表示不限 */
  const activeRepo = ref("");
  const sortBy = ref<"updated" | "usage" | "created">("updated");
  const selectedId = ref<string>("");

  async function load() {
    const saved = await readJson<PromptItem[] | null>("prompts", null);
    if (saved && saved.length) {
      items.value = saved;
    } else {
      items.value = BUILTIN.map((item) => createItem(item));
    }
    loaded.value = true;
  }

  let timer: number | undefined;
  function persist() {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void writeJson("prompts", JSON.parse(JSON.stringify(items.value))), 260);
  }

  function mutate(fn: () => void) {
    fn();
    persist();
  }

  /** 标签按出现次数排序：仓库案例会带来几百个关键词，常用的必须排前面 */
  const allTags = computed(() => {
    const counts = new Map<string, number>();
    items.value.forEach((item) => item.tags.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)));
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag]) => tag);
  });

  /** 本地已存在的仓库来源及其条数，用于来源筛选 */
  const repoStats = computed(() => {
    const counts = new Map<string, number>();
    items.value.forEach((item) => {
      if (item.source === "repo" && item.repo) counts.set(item.repo, (counts.get(item.repo) ?? 0) + 1);
    });
    return PROMPT_SOURCES.filter((source) => counts.has(source.repo)).map((source) => ({
      repo: source.repo,
      name: source.shortName,
      total: counts.get(source.repo) ?? 0,
    }));
  });

  const repoTotal = computed(() => items.value.filter((item) => item.source === "repo").length);

  const filtered = computed(() => {
    const text = keyword.value.trim().toLowerCase();
    let list = items.value.filter((item) => {
      if (onlyFavorite.value && !item.favorite) return false;
      if (sourceKind.value === "builtin" && item.source !== "builtin") return false;
      if (sourceKind.value === "repo" && item.source !== "repo") return false;
      if (sourceKind.value === "mine" && (item.source === "builtin" || item.source === "repo")) return false;
      if (activeRepo.value && item.repo !== activeRepo.value) return false;
      if (activeCategory.value && item.category !== activeCategory.value) return false;
      if (activeTag.value && !item.tags.includes(activeTag.value)) return false;
      if (!text) return true;
      return (
        item.title.toLowerCase().includes(text) ||
        item.content.toLowerCase().includes(text) ||
        item.tags.some((tag) => tag.toLowerCase().includes(text))
      );
    });
    list = [...list].sort((a, b) => {
      if (sortBy.value === "usage") return b.usageCount - a.usageCount;
      if (sortBy.value === "created") return b.createdAt - a.createdAt;
      return b.updatedAt - a.updatedAt;
    });
    return list;
  });

  const selected = computed(() => items.value.find((item) => item.id === selectedId.value));

  function add(patch: Partial<PromptItem> = {}) {
    const item = createItem({ source: "manual", ...patch });
    mutate(() => items.value.unshift(item));
    selectedId.value = item.id;
    return item;
  }

  function update(id: string, patch: Partial<PromptItem>) {
    mutate(() => {
      const target = items.value.find((item) => item.id === id);
      if (target) Object.assign(target, patch, { updatedAt: Date.now() });
    });
  }

  function remove(id: string) {
    mutate(() => {
      items.value = items.value.filter((item) => item.id !== id);
    });
    if (selectedId.value === id) selectedId.value = "";
  }

  function toggleFavorite(id: string) {
    const target = items.value.find((item) => item.id === id);
    if (target) update(id, { favorite: !target.favorite });
  }

  function markUsed(id: string) {
    const target = items.value.find((item) => item.id === id);
    if (!target) return;
    mutate(() => {
      target.usageCount += 1;
      target.updatedAt = Date.now();
    });
  }

  /** 已存在则累加使用次数，否则新建（用于从历史记录收藏提示词） */
  function saveFromContent(content: string, patch: Partial<PromptItem> = {}) {
    const existing = items.value.find((item) => item.content.trim() === content.trim());
    if (existing) {
      markUsed(existing.id);
      return existing;
    }
    return add({ content, title: content.slice(0, 18) || "来自历史记录", source: "history", ...patch });
  }

  function importItems(raw: unknown, mode: "merge" | "replace" = "merge"): number {
    const list = Array.isArray(raw) ? raw : (raw as { items?: unknown[] })?.items;
    if (!Array.isArray(list)) throw new Error("文件格式不支持，应为提示词数组");
    const parsed = list.map((entry) => {
      const record = entry as Partial<PromptItem>;
      return createItem({
        title: String(record.title ?? "导入提示词"),
        content: String(record.content ?? ""),
        negative: String(record.negative ?? ""),
        category: String(record.category ?? "其他"),
        tags: Array.isArray(record.tags) ? record.tags.map(String) : [],
        favorite: Boolean(record.favorite),
        usageCount: Number(record.usageCount ?? 0),
        structured: record.structured,
        source: "manual",
      });
    });
    mutate(() => {
      items.value = mode === "replace" ? parsed : [...parsed, ...items.value];
    });
    return parsed.length;
  }

  function exportItems(): string {
    return JSON.stringify({ version: 1, exportedAt: Date.now(), items: items.value }, null, 2);
  }

  /* ---------------------------------------------------------- 仓库拉取入库 */

  /**
   * 把仓库解析结果并入提示词库。
   * 匹配顺序：先按 sourceKey 原地更新（重新拉取不会产生重复条目），
   * 再退化为「正文相同」——README 与分类全集里的同一条案例编号不同但内容一致，
   * 靠这一步也能合并掉。
   */
  function importRepoItems(entries: RepoPromptEntry[]): { added: number; updated: number } {
    const byKey = new Map<string, PromptItem>();
    const byContent = new Map<string, PromptItem>();
    for (const item of items.value) {
      if (item.sourceKey) byKey.set(item.sourceKey, item);
      const key = normalizeContent(item.content);
      if (key && !byContent.has(key)) byContent.set(key, item);
    }

    const now = Date.now();
    const created: PromptItem[] = [];
    /** 本批新建的条目 id：同批内的重复内容不计入「更新」 */
    const createdIds = new Set<string>();
    let added = 0;
    let updated = 0;

    for (const entry of entries) {
      const contentKey = normalizeContent(entry.content);
      const existing = byKey.get(entry.sourceKey) ?? byContent.get(contentKey);
      if (existing) {
        const changed =
          existing.title !== entry.title ||
          existing.content !== entry.content ||
          existing.category !== entry.category ||
          existing.sourceUrl !== entry.url ||
          (existing.images?.length ?? 0) !== entry.images.length;
        Object.assign(existing, {
          title: entry.title,
          content: entry.content,
          category: entry.category,
          tags: entry.tags,
          source: "repo" as const,
          repo: entry.repo,
          sourceKey: entry.sourceKey,
          sourceUrl: entry.url,
          images: entry.images,
          author: entry.author,
          updatedAt: now,
        });
        // 内容与元信息都没变（或同批内的重复）就不算更新，避免重复拉取时数字乱跳
        if (changed && !createdIds.has(existing.id)) updated += 1;
        continue;
      }

      const item = createItem({
        title: entry.title,
        content: entry.content,
        category: entry.category,
        tags: entry.tags,
        source: "repo",
        repo: entry.repo,
        sourceKey: entry.sourceKey,
        sourceUrl: entry.url,
        images: entry.images,
        author: entry.author,
      });
      created.push(item);
      createdIds.add(item.id);
      byKey.set(entry.sourceKey, item);
      if (contentKey) byContent.set(contentKey, item);
      added += 1;
    }

    if (created.length) mutate(() => items.value = [...created, ...items.value]);
    return { added, updated };
  }

  /** 移除某个仓库拉取进来的全部条目，返回删除条数 */
  function removeRepoItems(repo: string): number {
    const before = items.value.length;
    mutate(() => {
      items.value = items.value.filter((item) => item.repo !== repo);
    });
    return before - items.value.length;
  }

  function countRepo(repo: string): number {
    return items.value.filter((item) => item.repo === repo).length;
  }

  function clearFilters() {
    keyword.value = "";
    activeCategory.value = "";
    activeTag.value = "";
    onlyFavorite.value = false;
    selectSource("");
  }

  /** 切换来源筛选（选中某个仓库时自动切到「仓库」大类） */
  function selectSource(kind: "" | "builtin" | "mine" | "repo", repo = "") {
    sourceKind.value = repo ? "repo" : kind;
    activeRepo.value = repo;
  }

  return {
    items,
    loaded,
    keyword,
    activeCategory,
    activeTag,
    onlyFavorite,
    sourceKind,
    activeRepo,
    sortBy,
    selectedId,
    selected,
    allTags,
    repoStats,
    repoTotal,
    filtered,
    load,
    add,
    update,
    remove,
    toggleFavorite,
    markUsed,
    saveFromContent,
    importItems,
    exportItems,
    importRepoItems,
    removeRepoItems,
    countRepo,
    selectSource,
    clearFilters,
  };
});

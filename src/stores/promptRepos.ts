/* ==========================================================================
   提示词仓库的拉取编排
   网络与解析都在 services/promptRepo.ts，这里只管：
   拉取状态、进度、上次拉取记录（落盘），以及调用 prompts store 入库。
   ========================================================================== */

import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type { PromptRepoRecord } from "../types";
import { readJson, writeJson } from "../platform/storage";
import { PROMPT_SOURCES, pullPromptSource, type PromptSource } from "../services/promptRepo";
import { usePromptStore } from "./prompts";

export interface PullOutcome {
  added: number;
  updated: number;
  /** 拉取后本地属于该来源的条数 */
  total: number;
  /** 成功读取的文档数 */
  docs: number;
  /** 跳过的文档（例如上游移走了某个分类文件） */
  failures: Array<{ path: string; message: string }>;
}

export const usePromptRepoStore = defineStore("promptRepos", () => {
  const records = ref<Record<string, PromptRepoRecord>>({});
  const loaded = ref(false);
  /** 正在拉取的来源 id，空表示空闲 */
  const pullingId = ref("");
  const progress = ref<{ step: string; done: number; total: number } | null>(null);

  async function load() {
    const saved = await readJson<Record<string, PromptRepoRecord>>("promptRepos", {});
    records.value = saved && typeof saved === "object" ? saved : {};
    loaded.value = true;
  }

  function persist() {
    void writeJson("promptRepos", JSON.parse(JSON.stringify(records.value)));
  }

  function recordOf(id: string): PromptRepoRecord | undefined {
    return records.value[id];
  }

  /** 拉取某个来源并入库；同一时间只允许一个拉取任务 */
  async function pull(source: PromptSource, options: { includeCollections?: boolean } = {}): Promise<PullOutcome> {
    if (pullingId.value) throw new Error("已有拉取任务在进行中");
    const prompts = usePromptStore();
    pullingId.value = source.id;
    progress.value = { step: "正在连接 GitHub…", done: 0, total: 1 };
    try {
      const result = await pullPromptSource(source, {
        includeCollections: options.includeCollections,
        onProgress: (next) => {
          progress.value = { ...next };
        },
      });
      const { added, updated } = prompts.importRepoItems(result.entries);
      const total = prompts.countRepo(source.repo);
      records.value = {
        ...records.value,
        [source.id]: { id: source.id, lastPulledAt: Date.now(), added, updated, total },
      };
      persist();
      return { added, updated, total, docs: result.docs, failures: result.failures };
    } finally {
      pullingId.value = "";
      progress.value = null;
    }
  }

  /** 移除某个来源已拉取的内容 */
  function clear(source: PromptSource): number {
    const prompts = usePromptStore();
    const removed = prompts.removeRepoItems(source.repo);
    const next = { ...records.value };
    delete next[source.id];
    records.value = next;
    persist();
    return removed;
  }

  return {
    sources: computed(() => PROMPT_SOURCES),
    records,
    loaded,
    pullingId,
    progress,
    load,
    pull,
    clear,
    recordOf,
  };
});

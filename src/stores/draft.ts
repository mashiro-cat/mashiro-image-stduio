import { reactive, ref, watch } from "vue";
import { defineStore } from "pinia";
import type { GenMode, GeneratedImage, ImageQuality, StructuredPrompt } from "../types";
import { readJson, writeJson } from "../platform/storage";
import { DEFAULT_APP, migrateDefaultSize } from "./settings";

/** 工作台草稿：跨页面传递「提示词 → 参数」，重启后仍在 */
export interface WorkbenchDraft {
  prompt: string;
  negative: string;
  structured: StructuredPrompt | null;
  style: string;
  size: string;
  count: number;
  quality: ImageQuality;
  /** 图生图参考图 */
  references: GeneratedImage[];
  seed: number | null;
  steps: number | null;
  /**
   * 工作流输入值（原始输入串，数字也存字符串）：
   * key = `${presetId}::${inputId}`。正向/负向提示词共用上面的 prompt/negative。
   */
  workflowValues: Record<string, string>;
  /** 工作流各图片输入槽位选用的图片：key 同上 */
  workflowImages: Record<string, GeneratedImage | null>;
  /** 来源提示词库条目 */
  promptId: string;
  /** 来源历史记录：复用参数 */
  fromRecordId: string;
}

const EMPTY: WorkbenchDraft = {
  prompt: "",
  negative: "",
  structured: null,
  style: "",
  size: DEFAULT_APP.defaultSize,
  count: DEFAULT_APP.defaultCount,
  quality: "high",
  references: [],
  seed: null,
  steps: null,
  workflowValues: {},
  workflowImages: {},
  promptId: "",
  fromRecordId: "",
};

/** 工作流槽位取值/图片的存储键：同一槽位在不同预设下互不干扰 */
export const workflowFieldKey = (presetId: string, inputId: string) => `${presetId}::${inputId}`;

export const useDraftStore = defineStore("draft", () => {
  const draft = reactive<WorkbenchDraft>({ ...EMPTY, references: [] });
  const loaded = ref(false);
  /** 待跳转的目标视图，路由监听到后消费 */
  const pendingTarget = ref<GenMode | "">("");

  async function load() {
    const saved = await readJson<Partial<WorkbenchDraft>>("draft", {});
    Object.assign(draft, saved, {
      references: Array.isArray(saved.references) ? saved.references : [],
      structured: saved.structured ?? null,
      workflowValues: saved.workflowValues && typeof saved.workflowValues === "object" ? saved.workflowValues : {},
      workflowImages: saved.workflowImages && typeof saved.workflowImages === "object" ? saved.workflowImages : {},
    });
    // 上一次留下的旧版默认尺寸（1:1）也一起升到「自动」
    draft.size = migrateDefaultSize(draft.size);
    loaded.value = true;
  }

  let timer: number | undefined;
  watch(
    draft,
    () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(
        () => void writeJson("draft", JSON.parse(JSON.stringify(draft))),
        400,
      );
    },
    { deep: true },
  );

  function patch(value: Partial<WorkbenchDraft>) {
    Object.assign(draft, value);
  }

  /** 从提示词库 / 历史记录 / 首页入口跳转到工作台 */
  function handoff(target: GenMode, value: Partial<WorkbenchDraft>) {
    patch(value);
    if (target === "text2img") {
      draft.references = [];
    }
    pendingTarget.value = target;
  }

  function consumeTarget(): GenMode | "" {
    const target = pendingTarget.value;
    pendingTarget.value = "";
    return target;
  }

  function addReference(image: GeneratedImage) {
    if (draft.references.length >= 4) return false;
    draft.references.push(image);
    return true;
  }

  function removeReference(id: string) {
    draft.references = draft.references.filter((image) => image.id !== id);
  }

  function clearReferences() {
    draft.references = [];
  }

  /* ------------------------------------------------------------ 工作流输入 */

  function setWorkflowValue(presetId: string, inputId: string, value: string) {
    const key = workflowFieldKey(presetId, inputId);
    if (value === "") delete draft.workflowValues[key];
    else draft.workflowValues[key] = value;
  }

  function setWorkflowImage(presetId: string, inputId: string, image: GeneratedImage | null) {
    const key = workflowFieldKey(presetId, inputId);
    if (image) draft.workflowImages[key] = image;
    else delete draft.workflowImages[key];
  }

  /** 清掉某个预设下所有图片槽位的选择（换工作流时用） */
  function clearWorkflowImages(presetId: string) {
    const prefix = `${presetId}::`;
    for (const key of Object.keys(draft.workflowImages)) {
      if (key.startsWith(prefix)) delete draft.workflowImages[key];
    }
  }

  function reset() {
    Object.assign(draft, { ...EMPTY, references: [], workflowValues: {}, workflowImages: {} });
  }

  return {
    draft,
    loaded,
    pendingTarget,
    load,
    patch,
    handoff,
    consumeTarget,
    addReference,
    removeReference,
    clearReferences,
    setWorkflowValue,
    setWorkflowImage,
    clearWorkflowImages,
    reset,
  };
});

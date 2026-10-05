import { ref } from "vue";
import type { EnhanceOptions, EnhanceResult, GeneratedImage, HistoryRecord } from "../types";
import { useSettingsStore } from "../stores/settings";
import { usePromptStore } from "../stores/prompts";
import { usePresetsStore } from "../stores/presets";
import { useDraftStore } from "../stores/draft";
import { useUiStore } from "../stores/ui";
import { importLocalFiles, toVisionDataUrl } from "../platform/media";
import { describeImages, describeRecord, enhancePrompt, MAX_VISION_IMAGES } from "../services/promptEnhance";
import { mockEnhance, mockReverse } from "../services/demo";

/** 打开系统文件选择器 */
export function openFilePicker(options: { accept?: string; multiple?: boolean } = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = options.accept ?? "image/*";
    input.multiple = options.multiple ?? false;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.oncancel = () => resolve([]);
    input.click();
  });
}

/**
 * 工作台通用动作：参考图导入、提示词增强、存入提示词库。
 * 所有状态统一落在 draft store 上，因此不同视图之间可无缝交接。
 */
export function useWorkbenchActions() {
  const settings = useSettingsStore();
  const prompts = usePromptStore();
  const presets = usePresetsStore();
  const draft = useDraftStore();
  const ui = useUiStore();

  const enhancing = ref(false);
  const enhanceResult = ref<EnhanceResult | null>(null);
  /**
   * 本次结果的来源：
   * - enhance：把用户想法扩写（有「增强前」可比）
   * - reverse：看图 / 看参数反推（没有原始提示词，展示上不画「增强前」）
   * 两者共用同一套「候选 → 采纳」流程，所以只用一个结果槽位。
   */
  const enhanceKind = ref<"enhance" | "reverse">("enhance");
  /** 增强结果是否已被用户采纳（采纳后才真正替换草稿里的提示词） */
  const enhanceApplied = ref(false);
  /** 增强前的提示词快照，用于在面板上做前后对比 */
  const enhanceOriginal = ref("");
  /** 本次增强真正随请求发送给模型的参考图数量 */
  const enhanceImages = ref(0);
  const importing = ref(false);

  async function pickImages(limit = 4) {
    const remaining = limit - draft.draft.references.length;
    if (remaining <= 0) {
      ui.warning("参考图已满", `最多上传 ${limit} 张`);
      return;
    }
    const files = await openFilePicker({ multiple: true });
    if (!files.length) return;

    importing.value = true;
    try {
      const accepted = files.filter((file) => file.type.startsWith("image/")).slice(0, remaining);
      if (!accepted.length) {
        ui.warning("格式不支持", "请选择 PNG / JPG / WEBP 图片");
        return;
      }
      const images = await importLocalFiles(accepted);
      images.forEach((image: GeneratedImage) => draft.addReference(image));
      if (files.length > remaining) ui.info("部分图片已忽略", `参考图上限为 ${limit} 张`);
      else ui.success(`已添加 ${images.length} 张参考图`);
    } catch (err) {
      ui.handleError(err, "导入图片失败");
    } finally {
      importing.value = false;
    }
  }

  async function addImagesFromFiles(files: File[]) {
    const remaining = 4 - draft.draft.references.length;
    const accepted = files.filter((file) => file.type.startsWith("image/")).slice(0, Math.max(0, remaining));
    if (!accepted.length) return;
    importing.value = true;
    try {
      const images = await importLocalFiles(accepted);
      images.forEach((image) => draft.addReference(image));
      ui.success(`已添加 ${images.length} 张参考图`);
    } catch (err) {
      ui.handleError(err, "导入图片失败");
    } finally {
      importing.value = false;
    }
  }

  async function visitHistoryImage(image: GeneratedImage) {
    if (draft.draft.references.length >= 4) {
      ui.warning("参考图已满", "最多 4 张");
      return;
    }
    draft.addReference(image);
    ui.success("已加入参考图");
  }

  /** 导入若干本地图片文件（不写入 draft），返回可用的图片 */
  async function importImages(files: File[]): Promise<GeneratedImage[]> {
    const accepted = files.filter((file) => file.type.startsWith("image/"));
    if (!accepted.length) {
      ui.warning("格式不支持", "请选择 PNG / JPG / WEBP 图片");
      return [];
    }
    importing.value = true;
    try {
      return await importLocalFiles(accepted);
    } catch (err) {
      ui.handleError(err, "导入图片失败");
      return [];
    } finally {
      importing.value = false;
    }
  }

  /** 选一张图片并返回（不写入 draft，供工作流的单个图片槽位使用） */
  async function pickOneImage(): Promise<GeneratedImage | null> {
    const files = await openFilePicker({ multiple: false });
    if (!files.length) return null;
    const images = await importImages(files);
    return images[0] ?? null;
  }

  function enhanceOptions(withReferences: boolean): EnhanceOptions {
    return {
      style: draft.draft.style || "",
      language: "en",
      structured: true,
      hasReference: withReferences && draft.draft.references.length > 0,
    };
  }

  /**
   * 把参考图转成多模态模型能吃的 data URL。
   * 矢量图 / 读取失败会被跳过——少送一张图好过整个请求失败。
   */
  async function collectVisionImages(references: GeneratedImage[]): Promise<string[]> {
    const list = await Promise.all(references.slice(0, MAX_VISION_IMAGES).map((image) => toVisionDataUrl(image)));
    return list.filter((url): url is string => Boolean(url));
  }

  /**
   * 增强提示词。
   *
   * `withReferences` 表示「当前是不是图生图场景」——**必须由调用方显式传入**：
   * draft 里的参考图是持久化的，文生图时它们只是上一次留下的数据（提交生图时也并不会用），
   * 早期版本直接读 draft.draft.references，导致文生图的增强请求里混进了几张图片 data URL。
   * 工作流的提示词增强与参考图无关，走默认的 false。
   */
  async function enhance(withReferences = false) {
    const prompt = draft.draft.prompt.trim();
    if (!prompt) {
      ui.warning("请先填写提示词");
      return null;
    }
    if (!settings.hasLlm && !settings.useDemo) {
      ui.error("未配置 LLM 模型", "请在设置页填写 openai-completions 协议的模型配置");
      return null;
    }

    const references = withReferences ? draft.draft.references : [];

    enhancing.value = true;
    enhanceKind.value = "enhance";
    enhanceApplied.value = false;
    enhanceOriginal.value = prompt;
    enhanceImages.value = 0;
    try {
      let result: EnhanceResult;
      if (settings.hasLlm) {
        const llm = settings.state.llm;
        // 图生图场景把参考图一起交给模型；纯文本模型可在设置页关掉
        const images = llm.sendImages && references.length ? await collectVisionImages(references) : [];
        enhanceImages.value = images.length;
        result = await enhancePrompt(llm, {
          prompt,
          negative: draft.draft.negative,
          referenceCount: references.length,
          images,
          options: enhanceOptions(withReferences),
        });
      } else {
        await new Promise((resolve) => setTimeout(resolve, 650));
        result = mockEnhance(prompt, draft.draft.negative, draft.draft.style);
      }

      enhanceResult.value = result;
      ui.success("提示词已增强，待确认采纳", "结果不会自动覆盖原提示词，请在「增强」页确认后采纳");
      return result;
    } catch (err) {
      enhanceResult.value = null;
      enhanceApplied.value = false;
      enhanceOriginal.value = "";
      ui.requestFailed("提示词增强失败", err);
      return null;
    } finally {
      enhancing.value = false;
    }
  }

  /* ------------------------------------------------------------ 提示词反推（看图写词） */

  /**
   * 反推的公共实现：产出与增强同构的结果，复用同一套「候选 → 采纳」流程。
   *
   * `enhanceOriginal` 置空表示「这不是改写，而是从零得出」——展示层据此隐藏
   * 「增强前 → 增强后」的对比，改为只呈现反推结果。
   */
  async function runReverse(source: { images: GeneratedImage[]; record?: HistoryRecord }) {
    if (!settings.hasLlm && !settings.useDemo) {
      ui.error("未配置 LLM 模型", "请在设置页填写 openai-completions 协议的模型配置");
      return null;
    }
    const hasImages = source.images.length > 0;
    if (!hasImages && !source.record) {
      ui.warning("没有可用于反推的内容", "请先选一张图片，或换一条带参数的记录");
      return null;
    }

    enhancing.value = true;
    enhanceKind.value = "reverse";
    enhanceApplied.value = false;
    enhanceOriginal.value = "";
    enhanceImages.value = 0;
    try {
      let result: EnhanceResult;
      if (settings.hasLlm) {
        const llm = settings.state.llm;
        // 参考图 -> 多模态 data URL；矢量图/读取失败会被跳过（少送一张好过整单失败）
        const images = hasImages
          ? await collectVisionImages(source.images.slice(0, MAX_VISION_IMAGES))
          : [];
        enhanceImages.value = images.length;
        if (images.length) {
          result = await describeImages(llm, images, { style: draft.draft.style });
        } else if (source.record) {
          result = await describeRecord(llm, source.record);
        } else {
          throw new Error("参考图无法读取（矢量图或不支持的格式），也没有可用于复盘的参数");
        }
      } else {
        await new Promise((resolve) => setTimeout(resolve, 650));
        result = mockReverse(source.record?.prompt ?? draft.draft.prompt, draft.draft.style, source.images.length);
      }

      enhanceResult.value = result;
      ui.success("已反推出提示词，待确认采纳", "确认后才会写入工作台");
      return result;
    } catch (err) {
      enhanceResult.value = null;
      enhanceApplied.value = false;
      enhanceImages.value = 0;
      ui.requestFailed("提示词反推失败", err);
      return null;
    } finally {
      enhancing.value = false;
    }
  }

  /** 看图写词：从给定图片反推（工作台传参考图，历史记录传该次的结果图） */
  function reverseFromImages(images: GeneratedImage[]) {
    return runReverse({ images });
  }

  /** 图生图的「看图写词」入口：用工作台当前的参考图反推 */
  function reverse() {
    return reverseFromImages(draft.draft.references);
  }

  /** 没有图片时，按历史记录的参数复盘 */
  function reverseFromRecord(record: HistoryRecord) {
    return runReverse({ images: [], record });
  }

  /** 采纳增强结果：写入草稿（这一步才算真正用上增强后的提示词） */
  function applyEnhance() {
    const result = enhanceResult.value;
    if (!result) return;
    draft.patch({
      prompt: result.prompt,
      negative: result.negative || draft.draft.negative,
      structured: result.structured,
    });
    enhanceApplied.value = true;
    if (enhanceKind.value === "reverse") {
      ui.success("已采纳反推结果", "提示词已填入工作台，现在可以直接生成");
    } else {
      ui.success("已采纳增强结果", "提示词已替换为增强版本，现在可以直接生成");
    }
  }

  /** 放弃增强结果 */
  function discardEnhance() {
    if (!enhanceResult.value) return;
    enhanceResult.value = null;
    enhanceApplied.value = false;
    enhanceOriginal.value = "";
    enhanceImages.value = 0;
    ui.info("已放弃增强结果", "原提示词保持不变");
  }

  function savePromptToLibrary() {
    const content = draft.draft.prompt.trim();
    if (!content) {
      ui.warning("提示词为空");
      return;
    }
    const item = prompts.saveFromContent(content, {
      negative: draft.draft.negative,
      structured: draft.draft.structured ?? undefined,
      title: content.slice(0, 18),
      category: "其他",
    });
    ui.success("已存入提示词库", `「${item.title}」可在提示词库中管理`);
  }

  /** 拼装最终提交用的提示词（附加风格预设） */
  function composeFinalPrompt() {
    const { prompt, style } = draft.draft;
    // 风格表来自 presets store（设置页可编辑）；不在这里另留一份映射——
    // 两份内容相同的清单一定会漂移，这里只做「查表 + 拼接」。
    const suffix = style ? presets.styleSuffix(style) : "";
    const base = prompt.trim().replace(/[,\s]+$/, "");
    return suffix ? `${base}, ${suffix}` : base;
  }

  /** 风格预设自带的负向词追加在用户填写的负向词之后 */
  function composeFinalNegative() {
    const { negative, style } = draft.draft;
    const extra = style ? presets.styleNegative(style) : "";
    return [negative.trim(), extra].filter(Boolean).join(", ");
  }

  /** 提示词被外部改写后，旧结果就不再有效，顺手清掉 */
  function resetEnhance() {
    enhanceResult.value = null;
    enhanceKind.value = "enhance";
    enhanceApplied.value = false;
    enhanceOriginal.value = "";
    enhanceImages.value = 0;
  }

  return {
    enhancing,
    importing,
    enhanceResult,
    enhanceKind,
    enhanceApplied,
    enhanceOriginal,
    enhanceImages,
    pickImages,
    addImagesFromFiles,
    pickOneImage,
    importImages,
    visitHistoryImage,
    enhance,
    reverse,
    reverseFromImages,
    reverseFromRecord,
    applyEnhance,
    discardEnhance,
    resetEnhance,
    savePromptToLibrary,
    composeFinalPrompt,
    composeFinalNegative,
  };
}

import { computed, onBeforeUnmount, ref } from "vue";
import type { GeneratedImage, GenMode, ImageQuality, StructuredPrompt, TaskStatus, WorkflowPreset } from "../types";
import { useSettingsStore } from "../stores/settings";
import { useHistoryStore, createRecord } from "../stores/history";
import { useUiStore } from "../stores/ui";
import { useDraftStore } from "../stores/draft";
import { ApiError } from "../platform/http";
import { editImages, generateImages } from "../services/modelApi";
import { collectResults, createTask, pollTask } from "../services/workflowApi";
import { mockEdit, mockGenerate } from "../services/demo";
import { imageToBase64, mimeFromPath } from "../platform/media";
import { formatDuration } from "../platform/env";

export interface ModelRunOptions {
  mode: Extract<GenMode, "text2img" | "img2img">;
  prompt: string;
  negative: string;
  structured: StructuredPrompt | null;
  styleLabel: string;
  size: string;
  count: number;
  quality: ImageQuality;
  references: GeneratedImage[];
}

export interface WorkflowRunOptions {
  preset: WorkflowPreset;
  /** 文本类槽位：inputId → 文本 */
  texts: Record<string, string>;
  /** 数值类槽位：inputId → 数值 */
  numbers: Record<string, number>;
  /** 图片类槽位：inputId → 图片 */
  images: Record<string, GeneratedImage | null>;
}

export function useGenerator() {
  const settings = useSettingsStore();
  const history = useHistoryStore();
  const ui = useUiStore();
  const draft = useDraftStore();

  const status = ref<TaskStatus>("idle");
  const progressText = ref("");
  const elapsed = ref(0);
  const images = ref<GeneratedImage[]>([]);
  const activeIndex = ref(0);
  const cancelled = ref(false);
  const recordId = ref("");

  let ticker: number | undefined;
  let startedAt = 0;

  const busy = computed(() => status.value === "running" || status.value === "queued");

  function startTicker() {
    startedAt = Date.now();
    elapsed.value = 0;
    stopTicker();
    ticker = window.setInterval(() => {
      elapsed.value = Date.now() - startedAt;
    }, 200);
  }

  function stopTicker() {
    if (ticker) window.clearInterval(ticker);
    ticker = undefined;
  }

  onBeforeUnmount(stopTicker);

  const activeImage = computed<GeneratedImage | null>(() => images.value[activeIndex.value] ?? null);

  function reset() {
    status.value = "idle";
    progressText.value = "";
    images.value = [];
    activeIndex.value = 0;
    stopTicker();
  }

  function cancel() {
    cancelled.value = true;
    status.value = "canceled";
    progressText.value = "已取消";
    stopTicker();
    if (recordId.value) {
      history.update(recordId.value, { status: "canceled", error: "用户已取消" });
    }
    ui.info("已取消本次生成");
  }

  function ensureModelReady(): boolean {
    if (settings.useDemo) return true;
    if (!settings.activeModelChannel) {
      ui.error("没有可用的生图渠道", "请到「设置 · 生图渠道」启用至少一个渠道并填写 API Key，或开启演示模式");
      return false;
    }
    return true;
  }

  /* ------------------------------------------------------------ 模型 API 生成 */

  async function runModel(options: ModelRunOptions) {
    if (!options.prompt.trim()) {
      ui.warning("提示词为空", "先描述你想要的画面再开始生成");
      return;
    }
    if (options.mode === "img2img" && !options.references.length) {
      ui.warning("缺少参考图", "图生图需要至少上传一张图片");
      return;
    }
    if (!ensureModelReady()) return;
    // 生图走「当前启用渠道」的配置；演示模式下不需要渠道
    const channel = settings.activeModelChannel;

    cancelled.value = false;
    status.value = "running";
    progressText.value = settings.useDemo ? "演示模式渲染中…" : `正在请求模型 · ${channel?.name ?? "未配置渠道"}…`;
    images.value = [];
    activeIndex.value = 0;
    startTicker();

    const record = createRecord({
      mode: options.mode,
      provider: "model",
      status: "running",
      prompt: options.prompt,
      negative: options.negative,
      structured: options.structured ?? undefined,
      params: {
        model: settings.useDemo ? "演示模式（占位图）" : channel?.model ?? "",
        channel: settings.useDemo ? "" : channel?.name ?? "",
        size: options.size,
        count: options.count,
        quality: options.quality,
      },
      inputImages: options.mode === "img2img" ? options.references.map((image) => image.path ?? image.url ?? "") : [],
      workflowName: "",
    });
    recordId.value = record.id;
    if (settings.state.app.autoSaveHistory) history.add(record);
    draft.patch({ prompt: options.prompt, negative: options.negative, size: options.size, count: options.count, quality: options.quality });

    try {
      let result: { images: GeneratedImage[]; revisedPrompts: string[] };

      if (settings.useDemo) {
        // 演示模式：保留真实交互节奏
        await new Promise((resolve) => setTimeout(resolve, 900 + options.count * 320));
        result =
          options.mode === "img2img"
            ? await mockEdit(options.prompt, options.size, options.count)
            : await mockGenerate(options.prompt, options.size, options.count);
      } else if (options.mode === "img2img") {
        const payload = [];
        for (const reference of options.references.slice(0, 4)) {
          const base64 = await imageToBase64(reference);
          if (!base64) continue;
          payload.push({
            fileName: `reference_${reference.id}.png`,
            mime: mimeFromPath(reference.path),
            dataBase64: base64,
          });
        }
        if (!payload.length) throw new ApiError("参考图读取失败，请重新上传");
        if (!channel) throw new ApiError("没有可用的生图渠道");
        result = await editImages(channel, {
          prompt: options.prompt,
          negative: options.negative,
          model: channel.model,
          n: options.count,
          size: options.size,
          quality: options.quality,
          images: payload,
        });
      } else {
        if (!channel) throw new ApiError("没有可用的生图渠道");
        result = await generateImages(channel, {
          prompt: options.prompt,
          negative: options.negative,
          model: channel.model,
          n: options.count,
          size: options.size,
          quality: options.quality,
        });
      }

      if (cancelled.value) return;

      images.value = result.images;
      activeIndex.value = 0;
      status.value = "success";
      progressText.value = `已生成 ${result.images.length} 张`;
      stopTicker();

      if (settings.state.app.autoSaveHistory) {
        history.update(record.id, {
          status: "success",
          images: result.images,
          durationMs: elapsed.value,
          prompt: result.revisedPrompts[0] ?? options.prompt,
        });
      }
      ui.success("生成完成", `${result.images.length} 张图片已保存到历史记录 · 用时 ${formatDuration(elapsed.value)}`);
    } catch (err) {
      stopTicker();
      status.value = "failed";
      const message = ui.describe(err);
      progressText.value = "生成失败";
      if (settings.state.app.autoSaveHistory) {
        history.update(record.id, { status: "failed", error: message, durationMs: elapsed.value });
      }
      ui.requestFailed("生成失败", err);
    }
  }

  /* ------------------------------------------------------------ 工作流生成 */

  async function runWorkflow(options: WorkflowRunOptions) {
    const channel = settings.activeWorkflowChannel;
    const { preset } = options;
    if (!channel || !settings.hasWorkflowApi) {
      ui.error("工作流未就绪", "请在「设置 · 工作流渠道」启用渠道并填写工作流 API Key");
      return;
    }
    if (!preset?.workflowId) {
      ui.error("请先配置工作流", "在当前渠道下添加一个 RunningHub 工作流 ID");
      return;
    }

    const inputs = preset.nodes.inputs.filter((input) => input.nodeId.trim());
    if (!inputs.length) {
      ui.error("该工作流还没有输入槽位", "到「设置 · 工作流渠道」点一次「识别节点」，或手动添加输入");
      return;
    }

    // 图片槽位逐个检查：漏一张会让任务在服务端直接失败，提交前就拦下来
    const imageInputs = inputs.filter((input) => input.role === "image");
    const missing = imageInputs.filter((input) => !options.images[input.id]);
    if (missing.length) {
      ui.warning("还缺图片", `请为「${missing.map((input) => input.label).join("、")}」选择图片`);
      return;
    }

    cancelled.value = false;
    status.value = "queued";
    progressText.value = "正在提交任务…";
    images.value = [];
    activeIndex.value = 0;
    startTicker();

    const record = createRecord({
      mode: "workflow",
      provider: "workflow",
      status: "running",
      prompt: Object.values(options.texts).find(Boolean) ?? "",
      negative: "",
      params: {
        size: "",
        seed: options.numbers[inputs.find((input) => input.role === "seed")?.id ?? ""],
        steps: options.numbers[inputs.find((input) => input.role === "steps")?.id ?? ""],
        model: preset.name,
        channel: channel.name,
      },
      inputImages: imageInputs
        .map((input) => options.images[input.id])
        .filter((image): image is GeneratedImage => Boolean(image))
        .map((image) => image.path ?? image.url ?? ""),
      workflowName: preset.name,
    });
    recordId.value = record.id;
    if (settings.state.app.autoSaveHistory) history.add(record);

    try {
      // 1) 逐个图片槽位上传，拿到各自的 fileName（工作流节点要的就是它，不是外链）
      const files: Record<string, string> = {};
      const { uploadAsset } = await import("../services/workflowApi");
      for (let index = 0; index < imageInputs.length; index += 1) {
        const input = imageInputs[index];
        const image = options.images[input.id];
        if (!image) continue;
        progressText.value =
          imageInputs.length > 1 ? `正在上传图片 ${index + 1}/${imageInputs.length}…` : "正在上传图片…";
        const base64 = await imageToBase64(image);
        if (!base64) throw new ApiError(`「${input.label}」读取失败，请重新选择图片`);
        const uploaded = await uploadAsset(channel, {
          fileName: `input_${image.id}.png`,
          mime: mimeFromPath(image.path),
          dataBase64: base64,
        });
        files[input.id] = uploaded.fileName;
      }

      // 2) 按槽位组装 nodeInfoList 并发起任务
      progressText.value = "正在提交工作流任务…";
      const created = await createTask(channel, {
        preset,
        values: { texts: options.texts, numbers: options.numbers, files },
      });

      history.update(record.id, { taskId: created.taskId });
      status.value = "running";
      progressText.value = `排队中 · 任务 ${created.taskId}`;

      const final = await pollTask(channel, created.taskId, {
        shouldStop: () => cancelled.value,
        onTick: (state) => {
          const label =
            state.status === "QUEUED" ? "排队中" : state.status === "RUNNING" ? "工作流执行中" : state.status;
          progressText.value = `${label} · ${
            state.results.length ? `已产出 ${state.results.length} 张` : "等待输出"
          } · ${formatDuration(Date.now() - startedAt)}`;
        },
      });

      if (cancelled.value) return;
      const resultImages = await collectResults(final);
      images.value = resultImages;
      activeIndex.value = 0;
      status.value = "success";
      progressText.value = `已生成 ${resultImages.length} 张`;
      stopTicker();

      if (settings.state.app.autoSaveHistory) {
        history.update(record.id, {
          status: "success",
          images: resultImages,
          durationMs: elapsed.value,
          taskId: final.taskId,
        });
      }
      ui.success("工作流执行完成", `${resultImages.length} 张图片已保存 · 用时 ${formatDuration(elapsed.value)}`);
    } catch (err) {
      stopTicker();
      status.value = cancelled.value ? "canceled" : "failed";
      const message = ui.describe(err);
      progressText.value = cancelled.value ? "已取消" : "任务失败";
      if (settings.state.app.autoSaveHistory && !cancelled.value) {
        history.update(record.id, { status: "failed", error: message, durationMs: elapsed.value });
      }
      if (!cancelled.value) ui.requestFailed("工作流任务失败", err);
    }
  }

  /**
   * 把超分产物追加进当前结果与当次历史记录。
   *
   * 放在这里而不是视图里，是因为**产物必须被历史记录引用**：
   * `history.collectReferencedPaths()` 只认「存活记录的 images」。
   * 视图里直接 push 图片数组而不写历史，磁盘上就会多一张谁都不认的孤儿文件——
   * 清理孤儿图片时它会被删掉，用户刚做的超分就白费了。
   *
   * 追加而不是替换：超分是同一次生图的衍生产物，用户要的是与原图对比。
   */
  function appendUpscaled(image: GeneratedImage) {
    images.value = [...images.value, image];
    activeIndex.value = images.value.length - 1;
    // 只登记到已存在的记录上：没有记录（如演示模式）时不能凭空造一条，
    // 那样会造出「有图但参数全空」的幽灵记录。
    if (recordId.value) {
      const record = history.records.find((item) => item.id === recordId.value);
      if (record) history.update(record.id, { images: [...record.images, image] });
    }
  }

  return {
    status,
    busy,
    progressText,
    elapsed,
    images,
    activeIndex,
    activeImage,
    recordId,
    runModel,
    runWorkflow,
    reset,
    cancel,
    appendUpscaled,
  };
}

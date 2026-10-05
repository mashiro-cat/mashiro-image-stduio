/* ==========================================================================
   本地超分偏好
   ---------------------------------------------------------------------------
   只存两件事：要不要在工作台显示超分入口、用哪个模型。
   **模型列表不在这里**——那是 Rust 侧注册表（upscale/model.rs）的事实，
   前端一律从 `services/upscale.ts` 问，抄一份必然会漂移。

   为什么不并进 `stores/settings.ts`：那是四套远端渠道配置的所在地，
   超分是唯一的本地能力，混进去会让 settings 越滚越大且语义不纯。
   ========================================================================== */

import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import { readJson, writeJson } from "../platform/storage";
import {
  getUpscaleStatus,
  listModels,
  probeGpu,
  type UpscaleModelInfo,
} from "../services/upscale";
import type { GeneratedImage } from "../types";

interface UpscaleFile {
  /**
   * 是否展示超分入口（侧边栏 / 工作台按钮 / 历史记录快捷入口）。
   *
   * **默认关**：超分是离线重活（CPU 上 1024² 约 1 分钟），
   * 绝大多数人不会用，入口常驻只会占侧边栏一个位置。
   * 想用的人去「设置 → 扩展能力 → 本地超分」开一次即可。
   */
  enabled?: boolean;
  /** 选中的模型 id（Rust 侧有对应注册项时才生效） */
  modelId?: string;
  /** 目标放大倍数（1~8） */
  scale?: number;
  /**
   * 输出长边上限（像素）。`0` = 不限制。
   *
   * **它不省推理时间**（模型固定 4×，推理量只取决于输入尺寸），
   * 省的是内存、磁盘与后续传输。2048² 放大后是 8192²，
   * 屏幕用途（4K 屏 3840 宽）通常给上限 4096 就够。
   */
  maxEdge?: number;
  /**
   * 是否启用 GPU 加速。
   *
   * **默认关闭**：实测 DirectML 在 RTX 3060 Ti 上只有 1.18× 加速，
   * 不足以值得「默认就多一个可能出错的环节」（驱动、虚拟桌面都可能失败）。
   * 想要的人在设置页自己开。
   */
  useGpu?: boolean;
}

export const useUpscaleStore = defineStore("upscale", () => {
  /**
   * 是否展示超分入口（侧边栏 / 工作台按钮 / 历史记录快捷入口）。
   *
   * **默认关**，理由见 `UpscaleFile.enabled`。
   *
   * 关掉不影响 `queue` 里已排队的活：`entryVisible` 会在队列非空时
   * 继续显示入口，用户不会因为关了个显示开关就找不到自己的图。
   */
  const enabled = ref(false);
  const modelId = ref("");
  const models = ref<UpscaleModelInfo[]>([]);
  const loaded = ref(false);
  const busy = ref("");
  /**
   * 目标放大倍数。
   *
   * 存的是**用户想要**的倍数，可以小于模型自身的倍数（比如 x4 模型出 2×）——
   * Rust 侧会在推理后做一次高质量重采样。**大于模型倍数是不允许的**，
   * 那样只能靠插值硬撑，既慢又没有额外细节。
   */
  const scale = ref(4);
  /**
   * 输出长边上限（像素），0 = 不限制。见 UpscaleFile.maxEdge。
   * **不省推理时间**，只省内存 / 磁盘 / 传输。
   */
  const maxEdge = ref(0);
  /** 是否启用 GPU 加速（DirectML）。默认关——理由见 UpscaleFile.useGpu */
  const useGpu = ref(false);
  /**
   * GPU 可用性：`null` = 还没检测过。
   *
   * 用三态而不是布尔：用户看到「关着」和「这台机器根本不支持」是两回事，
   * 混成 `false` 就分不清该提示什么。
   */
  const gpuSupported = ref<boolean | null>(null);
  /** 检测失败时的原因 */
  const gpuReason = ref("");
  /** 正在检测（探测要 1~2 秒，期间要禁用按钮） */
  const gpuProbing = ref(false);

  /**
   * 待处理队列：超分页的输入图片。
   *
   * **刻意不放在 `stores/draft`**：draft 持久化，且 `draft.references` 是
   * 「图生图参考图」——塞进去会既污染文生图请求（历史上踩过），
   * 又让 `collectReferencedPaths` 把「排队中但没在跑的图片」当成引用。
   * 这里只放内存，关掉应用即丢——排队中的东西本来就不该被持久化。
   */
  const queue = ref<GeneratedImage[]>([]);
  /** 已完成的产物（本轮超分产生的图） */
  const results = ref<GeneratedImage[]>([]);
  /**
   * 原图 id → 产物 id 的映射。
   *
   * **跑完不能把原图从 queue 里删掉**：产物就靠它跟原图配对做
   * 「原图 → 放大后」的并排对比，删了就只剩一张没有上下文的图。
   * 「待处理」的语义靠 `pending` 过滤，而不是靠移除。
   */
  const doneMap = ref<Record<string, string>>({});
  /** 由路由监听到后消费，避免跳转前后时序问题（与 draft.pendingTarget 同套路） */
  const pendingOpen = ref(false);

  /** 还没跑过的队列项（真正的「待处理」） */
  const pending = computed(() => {
    const done = new Set(Object.keys(doneMap.value));
    return queue.value.filter((image) => !done.has(image.id));
  });

  /** 已下载到本机的模型 */
  const installedModels = computed(() => models.value.filter((item) => item.installed));
  /** 有模型就绪时才算真的可用 */
  const available = computed(() => installedModels.value.length > 0);

  /**
   * 侧边栏 / 历史记录里的「超分入口」该不该显示。
   *
   * 开关之外还有一条硬约束：**队列非空时永远显示**。
   * 队列是内存态、页面一关就没了，此时把入口藏起来等于让用户
   * 找不到回去的路——只能重启应用从头再来。
   * （同理，用户此刻正站在超分页上时入口也得留着，
   * 那是侧边栏在标示「你在这里」，藏了就成了无导航的死胡同。）
   */
  const entryVisible = computed(() => enabled.value || queue.value.length > 0);

  /** 实际会用到的模型：优先用户选的，没选或失效则取第一个已下载的 */
  const activeModel = computed<UpscaleModelInfo | null>(() => {
    const chosen = models.value.find((item) => item.id === modelId.value && item.installed);
    return chosen ?? installedModels.value[0] ?? null;
  });

  /**
   * 当前可选的倍数列表。
   *
   * **只提供模型原生支持的倍数**——x4 模型只给 4×，不给 2×/3×。
   *
   * 曾经提供 1~4× 让用户「随便选」，但那是个陷阱：
   * 选 2× 时模型**仍然要跑完整的 4× 推理**（耗时一点不减），
   * 只是最后把结果缩回 2×。大图上表现就是「一直处理中」——
   * 用户以为卡住了，实际上是在做一件对结果毫无意义的工作。
   * 要支持 2×/3× 得换用对应档位的模型（如 realesr-animevideov3-x2 / -x3），
   * 那是有意义的扩展，不是插值能替代的。
   */
  const scaleOptions = computed(() => {
    const native = activeModel.value?.scale ?? 4;
    return [native];
  });

  async function load() {
    const saved = await readJson<UpscaleFile>("upscale", {});
    // 默认关，所以 `Boolean(undefined)` 正好就是「没存过 = 关闭」，不需要三目
    enabled.value = Boolean(saved.enabled);
    modelId.value = typeof saved.modelId === "string" ? saved.modelId : "";
    scale.value = typeof saved.scale === "number" && saved.scale >= 1 ? saved.scale : 4;
    maxEdge.value = typeof saved.maxEdge === "number" && saved.maxEdge >= 0 ? saved.maxEdge : 0;
    useGpu.value = Boolean(saved.useGpu);
    await refresh();
    // 换模型后要夹一次：4× 模型降到 1× 的用户换到只支持 2× 的模型上，
    // 选项变了但当前值可能已不可用
    if (!scaleOptions.value.includes(scale.value)) {
      scale.value = scaleOptions.value[scaleOptions.value.length - 1] ?? 1;
    }
    loaded.value = true;
  }

  /** 重新问 Rust 侧要模型列表与安装状态（下载/删除后要调） */
  async function refresh() {
    try {
      models.value = await listModels();
      const status = await getUpscaleStatus();
      // 选中的模型没下（或被删了）→ 回落成第一个可用的
      if (!models.value.some((item) => item.id === modelId.value && item.installed)) {
        modelId.value = status.installed[0] ?? "";
      }
    } catch {
      models.value = [];
    }
  }

  function setEnabled(value: boolean) {
    enabled.value = value;
  }

  function selectModel(id: string) {
    modelId.value = id;
  }

  function setUseGpu(value: boolean) {
    useGpu.value = value;
  }

  /**
   * 探测本机 GPU 可用性。
   *
   * **不在 `load()` 里自动调**：探测要真的建一次 ONNX 会话（1~2 秒），
   * 而 `load()` 在 App 启动时就会跑——每次启动都卡两秒是不能接受的。
   * 只在用户点「检测」时调。
   */
  async function detectGpu() {
    if (gpuProbing.value) return;
    gpuProbing.value = true;
    gpuReason.value = "";
    try {
      const probe = await probeGpu(modelId.value || undefined);
      gpuSupported.value = probe.supported;
      gpuReason.value = probe.reason;
      // 检测显示不支持时，把开关也关掉——留着「已开但跑不了」的状态最让人困惑
      if (!probe.supported) useGpu.value = false;
    } catch (err) {
      gpuSupported.value = false;
      gpuReason.value = err instanceof Error ? err.message : String(err);
    } finally {
      gpuProbing.value = false;
    }
  }

  /* ------------------------------------------------------------ 队列 */

  /** 单批最多处理多少张：CPU 推理是串行的，堆太多会让人等很久 */
  const MAX_QUEUE = 8;

  /**
   * 把图片加入超分队列（历史记录 / 灯箱的快捷入口用）。
   *
   * 重复的按 `id` 去重——同一张图从两个地方送进来只应出现一次。
   * 队列里只放**有本地文件**的：远端链接或内联 data URL 无法推理，
   * 塞进来只会在跑的时候才失败，体验比现在直接拒掉更差。
   */
  function enqueue(images: GeneratedImage[]) {
    const usable = images.filter((image) => Boolean(image.path));
    if (!usable.length) return 0;

    const known = new Set(queue.value.map((image) => image.id));
    let added = 0;
    for (const image of usable) {
      if (known.has(image.id)) continue;
      if (queue.value.length >= MAX_QUEUE) break;
      queue.value = [...queue.value, image];
      known.add(image.id);
      added += 1;
    }
    return added;
  }

  function enqueueOne(image: GeneratedImage) {
    return enqueue([image]) > 0;
  }

  function removeFromQueue(id: string) {
    queue.value = queue.value.filter((image) => image.id !== id);
    // 连带清掉配对关系，否则 mapping 会指向一张已不在队列里的图
    const next = { ...doneMap.value };
    delete next[id];
    doneMap.value = next;
  }

  function clearQueue() {
    queue.value = [];
    doneMap.value = {};
  }

  /** 把产物接在结果末尾，并记下它跟哪张原图配对 */
  function addResult(image: GeneratedImage, sourceId: string) {
    results.value = [...results.value, image];
    doneMap.value = { ...doneMap.value, [sourceId]: image.id };
  }

  /** 查某个产物对应的原图（对比区用） */
  function sourceOf(resultId: string): GeneratedImage | null {
    const entry = Object.entries(doneMap.value).find(([, id]) => id === resultId);
    if (!entry) return null;
    return queue.value.find((image) => image.id === entry[0]) ?? null;
  }

  function clearResults() {
    results.value = [];
    doneMap.value = {};
  }

  /**
   * 跳转到超分页（历史记录快捷入口用）。
   * 置 `pendingOpen` 让目标页知道「参数已就绪，可以直接看队列」——
   * 否则用户会看到空页面以为没点上。
   */
  function openWith(image: GeneratedImage) {
    enqueueOne(image);
    pendingOpen.value = true;
  }

  function consumeOpen(): boolean {
    const value = pendingOpen.value;
    pendingOpen.value = false;
    return value;
  }

  let timer: number | undefined;
  function persist() {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void writeJson("upscale", {
        enabled: enabled.value,
        modelId: modelId.value,
        scale: scale.value,
        useGpu: useGpu.value,
        maxEdge: maxEdge.value,
      });
    }, 320);
  }

  watch([enabled, modelId, scale, useGpu, maxEdge], persist);

  return {
    enabled,
    modelId,
    scale,
    maxEdge,
    useGpu,
    gpuSupported,
    gpuReason,
    gpuProbing,
    models,
    loaded,
    busy,
    queue,
    results,
    doneMap,
    pendingOpen,
    pending,
    installedModels,
    available,
    entryVisible,
    activeModel,
    scaleOptions,
    load,
    refresh,
    setEnabled,
    selectModel,
    setUseGpu,
    detectGpu,
    enqueue,
    enqueueOne,
    removeFromQueue,
    clearQueue,
    addResult,
    sourceOf,
    clearResults,
    openWith,
    consumeOpen,
  };
});

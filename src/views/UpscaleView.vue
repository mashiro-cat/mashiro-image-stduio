<script setup lang="ts">
/**
 * 图片超分页。
 *
 * 推理在 Rust 侧完成（`src-tauri/src/upscale/`），这里负责编排：
 * 攒待处理队列 → 逐张跑 → 展示原图与产物的对比。
 *
 * # 为什么单独一页，而不是在工作台工具条加个按钮
 *
 * 超分是「拿到已有图 → 放大」的独立流程，跟生图的两件事：
 * - **输入不同**：它的输入来自历史记录 / 本地文件，不是提示词
 * - **需要对比**：原图与产物必须并排看，否则用户无法判断放大有没有意义
 * 工作台的 PreviewStage 承担不了对比职责，所以独立成页。
 *
 * # 队列是内存态
 *
 * `stores/upscale.ts` 的 `queue` 不持久化（详见那里的注释）：
 * 排队中的东西不该跨重启存活，也不该混进 `draft.references`。
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useUpscaleStore } from "../stores/upscale";
import { useHistoryStore, createRecord } from "../stores/history";
import { useUiStore } from "../stores/ui";
import { useSettingsStore } from "../stores/settings";
import { upscaleImage, upscaleBatch, toGeneratedImage, type UpscaleResult } from "../services/upscale";
import { importLocalFiles, probeImageSize, downloadImage } from "../platform/media";
import { revealInFolder, dataRoot } from "../platform/storage";
import { isTauri, formatDuration, fileUrl } from "../platform/env";
import { openFilePicker } from "../composables/useWorkbenchActions";
import { t } from "../i18n";
import type { GeneratedImage } from "../types";
import UiIcon from "../components/ui/UiIcon.vue";
import UiSmartImage from "../components/ui/UiSmartImage.vue";

const router = useRouter();
const upscale = useUpscaleStore();
const history = useHistoryStore();
const ui = useUiStore();
const settings = useSettingsStore();

/** 正在处理第几张；-1 表示空闲 */
const runningIndex = ref(-1);
/** 单张耗时，用于估算剩余 */
const lastElapsed = ref(0);
/**
 * 本轮实际使用的后端（"CPU" / "GPU（DirectML）"）。
 *
 * 由 Rust 侧如实回报——用户开了 GPU 但注册失败时会回退 CPU，
 * 这时界面必须显示 CPU 而不是继续宣称 GPU 加速。
 */
const backendUsed = ref("");
/** 对比卡的当前选择 */
const compareIndex = ref(0);
/** 每个产物的尺寸信息（原图 → 产物的对比靠它） */
const sizeMap = ref<Record<string, { w: number; h: number }>>({});
const importing = ref(false);

/**
 * 输出长边上限的可选值。
 *
 * **必须让用户知道这一项不省时间**（hint 里写了）：模型固定 4×，
 * 推理量只取决于输入尺寸。它省的是内存 / 磁盘 / 后续传输。
 * 不写清楚会有人以为「限到4096 就更快」，那是误解。
 *
 * 放在 `computed` 里：词条必须在渲染期取，模块级常量会锁死启动时的语言。
 */
const MAX_EDGE_OPTIONS = computed(() => [
  {
    value: 0,
    label: t("upscale.maxEdge.original"),
    hint: t("upscale.maxEdge.originalHint"),
  },
  { value: 4096, label: t("upscale.maxEdge.l4096"), hint: t("upscale.maxEdge.l4096Hint") },
  { value: 2048, label: t("upscale.maxEdge.l2048"), hint: t("upscale.maxEdge.l2048Hint") },
]);

const desktop = isTauri();
const model = computed(() => upscale.activeModel);
const running = computed(() => runningIndex.value >= 0);
/** 队列里有本地文件才可能推理（enqueue 已过滤，这里是防御性判断） */
const readyCount = computed(() => upscale.pending.filter((item) => Boolean(item.path)).length);
const total = computed(() => upscale.queue.length);

/**
 * 「开始超分」能否点击。
 *
 * 缺模型时**仍然可点**——按钮会给出「去下载模型」并跳转设置页。
 * 灰着是不可点的，用户点不到也就看不到那句说明，等于死路一条。
 * （这是实测反馈：原先要求 `Boolean(model.value)`，浏览器预览下
 * 按钮永远禁用，用户完全不知道下一步该做什么。）
 */
const canRun = computed(() => !running.value && readyCount.value > 0);

/** 按钮文案：把「不可点」的原因说清楚，而不是灰着让人猜 */
const runLabel = computed(() => {
  if (running.value) return t("upscale.run.processing");
  if (!readyCount.value) return total.value ? t("upscale.run.allDone") : t("upscale.run.start");
  if (!model.value) return t("upscale.run.needModel");
  return t("upscale.run.startWithCount", { count: readyCount.value, scale: upscale.scale });
});

/** 没模型时点了就带去设置页，而不是静默失败 */
function handleRun() {
  if (!model.value) {
    ui.warning(t("upscale.msg.noModel.title"), t("upscale.msg.noModel.desc"));
    goSettings();
    return;
  }
  void runAll();
}

function clearAll() {
  upscale.clearQueue();
  upscale.clearResults();
  sizeMap.value = {};
  compareIndex.value = 0;
}

/** 空状态的三种成因，标题与提示语都不一样 */
const emptyState = computed(() => {
  if (!desktop) {
    return {
      icon: "info",
      title: t("upscale.empty.desktopOnly.title"),
      hint: t("upscale.empty.desktopOnly.hint"),
    };
  }
  if (!upscale.available) {
    return {
      icon: "download",
      title: t("upscale.empty.noModel.title"),
      hint: t("upscale.empty.noModel.hint"),
      action: true,
    };
  }
  return {
    icon: "image",
    title: t("upscale.empty.ready.title"),
    hint: t("upscale.empty.ready.hint"),
  };
});

/** 历史记录送过来的图片：等 store 就绪后再消费 */
watch(
  () => upscale.consumeOpen(),
  (opened) => {
    if (opened) void router.replace("/upscale");
  },
  { immediate: true },
);

// 队列变化时先量尺寸：提示里的耗时估算要用它，
// 而且用户「加入图片后、点开始前」这一刻就该看到预期。
watch(
  () => upscale.queue.map((image) => image.id).join(","),
  () => {
    for (const image of upscale.pending) {
      if (sizeMap.value[image.id]) continue;
      void measure(image);
    }
  },
  { immediate: true },
);

// 队列变化时，把对比游标夹回合法范围
watch(
  () => upscale.results.length,
  (count) => {
    if (count && compareIndex.value >= count) compareIndex.value = count - 1;
  },
);

/** 当前放大预览的原图与产物 */
const comparePair = computed(() => {
  const result = upscale.results[compareIndex.value];
  if (!result) return null;
  // 原图通过 doneMap 配对找回（跑完不移出队列，只是不再算「待处理」）
  return { result, source: upscale.sourceOf(result.id) };
});

/* ------------------------------------------------------------ 队列操作 */

async function pickFiles() {
  if (!desktop) return;
  const files = await openFilePicker({ multiple: true });
  if (!files.length) return;
  const accepted = files.filter((file) => file.type.startsWith("image/"));
  if (!accepted.length) {
    ui.warning(t("upscale.msg.unsupportedFormat.title"), t("upscale.msg.unsupportedFormat.pick"));
    return;
  }
  importing.value = true;
  try {
    const images = await importLocalFiles(accepted);
    const added = upscale.enqueue(images);
    if (!added) {
      ui.warning(t("upscale.msg.nothingToAdd"), t("upscale.msg.nothingToAdd.desc"));
    } else {
      ui.success(t("upscale.msg.added", { count: added }));
    }
  } catch (err) {
    ui.handleError(err, t("upscale.msg.importFailed"));
  } finally {
    importing.value = false;
  }
}

/** 拖拽导入：dataTransfer.files 拿不到持久化路径，靠 importLocalFiles 落盘 */
const dragOver = ref(false);

function onDrop(event: DragEvent) {
  dragOver.value = false;
  const files = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
    file.type.startsWith("image/"),
  );
  if (!files.length) {
    ui.warning(t("upscale.msg.unsupportedFormat.title"), t("upscale.msg.unsupportedFormat.drop"));
    return;
  }
  void (async () => {
    importing.value = true;
    try {
      const images = await importLocalFiles(files);
      const added = upscale.enqueue(images);
      if (added) ui.success(t("upscale.msg.added", { count: added }));
      else ui.warning(t("upscale.msg.nothingToAdd"), t("upscale.msg.nothingToAdd.desc"));
    } catch (err) {
      ui.handleError(err, t("upscale.msg.importFailed"));
    } finally {
      importing.value = false;
    }
  })();
}

/* ------------------------------------------------------------ 执行超分 */

/** 记录一张图的像素尺寸（探测失败就跳过，不影响流程） */
async function measure(image: GeneratedImage): Promise<void> {
  const src = await fileSrc(image);
  if (!src) return;
  const size = await probeImageSize(src);
  if (size) sizeMap.value[image.id] = { w: size.width, h: size.height };
}

async function runOne(image: GeneratedImage, index: number) {
  const active = model.value;
  if (!active || running.value) return;

  await measure(image);
  runningIndex.value = index;
  const startedAt = Date.now();
  try {
    const result = await upscaleImage(image, active.id, upscale.scale, upscale.useGpu, upscale.maxEdge || undefined);
    lastElapsed.value = Date.now() - startedAt;
    finishOne(image, result, startedAt);
  } catch (err) {
    ui.requestFailed(t("upscale.msg.failed.title"), err);
  } finally {
    runningIndex.value = -1;
  }
}

/** 登记单张产物：进结果区、做配对、写历史 */
function finishOne(source: GeneratedImage, result: UpscaleResult, startedAt: number) {
  const produced = toGeneratedImage(result);
  sizeMap.value[produced.id] = { w: result.width, h: result.height };
  // 如实记录实际后端：开了 GPU 但回退了 CPU 时，界面要能看出来
  backendUsed.value = result.backend;
  // 原图留在队列里（只标记完成），对比区要靠它做「原图 → 放大后」
  upscale.addResult(produced, source.id);
  registerHistory(produced, source, Date.now() - startedAt);
}

/**
 * 批量超分：走 Rust 侧的 `upscale_batch`。
 *
 * 不用前端循环调 `upscale_image`——那样每张都要过一次 IPC 往返，
 * 而且**进度只有全部完成才知道**。批量命令在 Rust 里逐张处理、
 * 失败不中断整批，回来时能一次拿到全部产物。
 */
async function runAll() {
  if (running.value || !upscale.pending.length) return;
  const active = model.value;
  if (!active) {
    ui.warning(t("upscale.msg.noUsableModel.title"), t("upscale.msg.noUsableModel.desc"));
    return;
  }

  const batch = upscale.pending.filter((image) => Boolean(image.path));
  if (!batch.length) {
    ui.warning(t("upscale.msg.queueNoLocal.title"), t("upscale.msg.queueNoLocal.desc"));
    return;
  }

  // 先量原图尺寸（放大后要展示「原尺寸 → 放大后」）
  await Promise.all(batch.map((image) => measure(image)));

  runningIndex.value = 0;
  const startedAt = Date.now();
  try {
    const results = await upscaleBatch(batch, active.id, upscale.scale, upscale.useGpu, upscale.maxEdge || undefined);
    const elapsed = Date.now() - startedAt;
    lastElapsed.value = results.length ? Math.round(elapsed / results.length) : elapsed;

    for (let i = 0; i < results.length; i += 1) {
      runningIndex.value = i;
      finishOne(batch[i], results[i], startedAt);
    }

    const failed = batch.length - results.length;
    if (results.length) {
      const seconds = (lastElapsed.value / 1000).toFixed(1);
      ui.success(
        t("upscale.msg.done.title", { count: results.length }),
        failed
          ? t("upscale.msg.done.partial", { failed, seconds })
          : t("upscale.msg.done.ok", { scale: upscale.scale, seconds }),
      );
    } else {
      ui.error(t("upscale.msg.allFailed.title"), t("upscale.msg.allFailed.desc"));
    }
  } catch (err) {
    ui.requestFailed(t("upscale.msg.batchFailed.title"), err);
  } finally {
    // 必须在 finally 里复位：`upscale_batch` 失败时抛异常，
    // 不复位会让「开始超分」永久停在「处理中…」且按钮点不动。
    runningIndex.value = -1;
  }
}

/**
 * 把产物登记进历史记录。
 *
 * **这一步不能省**：`history.collectReferencedPaths()` 只认存活记录里的图片。
 * 产物若不挂到某条记录上，磁盘上就是一张谁都不认的孤儿文件，
 * `sweepOrphans()` 会把它删掉，用户刚做的超分就白费了。
 *
 * 挂成独立记录（而不是追加到原记录）：原记录可能被删，
 * 而超分产物有自己的尺寸与模型信息，单独一条更好回溯。
 */
function registerHistory(result: GeneratedImage, source: GeneratedImage, durationMs: number) {
  if (!settings.state.app.autoSaveHistory) return;
  const resultSize = sizeMap.value[result.id];
  history.add(
    createRecord({
      mode: "text2img",
      provider: "upscale",
      status: "success",
      prompt: "",
      negative: "",
      params: {
        // ⚠️ 这两个值会**持久化进历史记录**：`model` 用于回显当时的模型，
        // `tags` 参与历史页的标签筛选（另有 provider: "upscale" 做权威判定）。
        // 所以保持中文原值，不随界面语言变化——否则切一次语言，
        // 已有记录的标签筛选就全部失配了。
        model: model.value?.label ?? "本地超分",
        size: resultSize ? `${resultSize.w}x${resultSize.h}` : "auto",
        count: 1,
      },
      images: [result],
      tags: ["超分"],
      inputImages: source.path ? [source.path] : undefined,
      durationMs: durationMs || undefined,
    }),
  );
  // 这里刻意不 toast：批量处理时每张都弹一次会刷屏，
  // 尺寸对比由 runAll 的汇总提示统一给出。
}

/* ------------------------------------------------------------ 工具 */

/** 图片的可展示地址（本地文件 → 远端 → 内联） */
async function fileSrc(image: GeneratedImage): Promise<string> {
  if (image.path && desktop) {
    return (await fileUrl(image.path)) ?? "";
  }
  return image.url ?? image.dataUrl ?? "";
}

async function revealResult(image: GeneratedImage) {
  if (!image.path) {
    ui.warning(t("upscale.msg.noLocalFile"));
    return;
  }
  const res = await revealInFolder(image.path);
  if (res.ok) ui.success(t("upscale.msg.revealed"));
  else ui.warning(t("upscale.msg.revealFailed.title"), res.error ?? t("upscale.msg.revealFailed.desc"));
}

async function downloadResult(image: GeneratedImage) {
  const saved = await downloadImage(image, `mashiro_upscale_${image.id}.png`);
  if (saved) ui.success(t("upscale.msg.saved"), saved);
  else ui.error(t("upscale.msg.saveFailed.title"), t("upscale.msg.saveFailed.desc"));
}

async function revealModelDir() {
  const root = await dataRoot();
  if (!root) return;
  const res = await revealInFolder(`${root}\\models`);
  if (res.ok) ui.success(t("upscale.msg.modelDirOpened"));
  else ui.warning(t("upscale.msg.modelDirFailed"), res.error ?? "");
}

function goSettings() {
  void router.push("/settings?tab=upscale");
}

/**
 * 剩余时间预估。
 *
 * 批量模式下一次 IPC 就跑完整批，**期间拿不到逐张进度**，
 * 所以这里只在「已经跑过、知道单张耗时」之后才给预估，否则不显示——
 * 凭空猜一个数字比不给更糟。
 */
const etaText = computed(() => {
  if (!running.value || !lastElapsed.value) return "";
  const left = Math.max(0, (readyCount.value || total.value) - 1) * lastElapsed.value;
  return left > 0 ? t("upscale.running.eta", { time: formatDuration(left) }) : "";
});

/**
 * 首次超分的额外耗时提示。
 *
 * 第一次推理要加载 ONNX 会话（解析图 + 优化算子，实测 1~2 秒），
 * 这部分开销只付一次。不说的话，用户会以为「这次特别慢」。
 */
const firstRunHint = computed(() => {
  if (!upscale.pending.length) return "";
  if (lastElapsed.value) return "";
  const px = readyCount.value || total.value;
  // 按**实际尺寸**估算：实测 CPU 约 55 秒 / 1024²·张，耗时与面积成正比
  const first = upscale.pending[0];
  const size = first ? sizeMap.value[first.id] : undefined;
  if (!size) {
    return t("upscale.hint.firstRunUnknown", { count: px });
  }
  const megapixels = (size.w * size.h) / 1_000_000;
  const seconds = Math.round(megapixels * 55);
  const text =
    seconds >= 90
      ? t("upscale.hint.minutes", { count: Math.round(seconds / 60) })
      : t("upscale.hint.seconds", { count: seconds });
  return t("upscale.hint.firstRunBySize", { count: px, time: text });
});

onBeforeUnmount(() => {
  // 页面卸载不清队列：用户可能只是切去历史记录再送几张回来
  sizeMap.value = {};
});
</script>

<template>
  <div class="up">
    <!--
      头部只放标题，**不放操作按钮**。
      toast 固定在 `top: titlebar+12px; right:16px`（见 UiToastHost.vue），
      与头部右侧同一片区域——「加入图片」的提示飘过来时正好压住按钮。
      操作区因此单独放在下面的工具条里，位置与 toast 不重叠。
    -->
    <header class="up-head">
      <div>
        <h1 class="up-title">{{ t('upscale.title') }}</h1>
        <p class="up-sub">{{ t('upscale.subtitle') }}</p>
      </div>
      <span v-if="model" class="tag">{{ t('upscale.currentModel', { name: model.label }) }}</span>
    </header>

    <!-- ============================================ 参数与操作 -->
    <div class="card card-pad toolbar">
      <div class="tool-row">
        <span class="tool-label">{{ t('upscale.scale.label') }}</span>
        <!--
          只有模型原生档位才做成可点的分段控件。
          单个选项时退化成只读标签——给一个「只能点这一个」的按钮组
          是噪音，反而让人以为还能选别的。
        -->
        <div v-if="upscale.scaleOptions.length > 1" class="scale-group">
          <button
            v-for="option in upscale.scaleOptions"
            :key="option"
            class="scale-btn"
            :class="{ 'is-active': upscale.scale === option }"
            :disabled="running"
            @click="upscale.scale = option"
          >
            {{ option }}×
          </button>
        </div>
        <span v-else class="scale-fixed">
          {{ upscale.scaleOptions[0] ?? 4 }}×
        </span>
        <span class="t-xs t-3rd scale-note">
          {{ model ? t('upscale.scale.note', { name: model.label, scale: model.scale }) : t('upscale.scale.note.noModel') }}
        </span>
        <!--
          显示**实际跑在什么上**，而不是用户勾了什么。
          开了 GPU 但注册失败时 Rust 会回退 CPU，这时必须如实显示 CPU。
        -->
        <span v-if="upscale.useGpu || backendUsed" class="tag" :class="backendUsed.includes('GPU') ? 'tag-accent' : ''">
          {{ backendUsed || (upscale.useGpu ? t('upscale.backend.gpuPending') : t('upscale.backend.cpu')) }}
        </span>
        <div class="scale-group">
          <button
            v-for="opt in MAX_EDGE_OPTIONS"
            :key="opt.value"
            class="scale-btn"
            :class="{ 'is-active': upscale.maxEdge === opt.value }"
            :disabled="running"
            :title="opt.hint"
            @click="upscale.maxEdge = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>

        <!-- 排队时就把耗时预期说清楚，别让用户对着转圈猜 -->
        <span v-if="total && !running" class="t-xs t-3rd scale-note">
          {{
            lastElapsed
              ? t('upscale.hint.lastRun', {
                  count: readyCount || total,
                  time: formatDuration(lastElapsed * (readyCount || total)),
                })
              : firstRunHint
          }}
        </span>
      </div>

      <div class="row gap-2">
        <button class="btn btn-ghost" :disabled="running || !total" @click="clearAll">
          <UiIcon name="trash" :size="15" />{{ t('upscale.action.clear') }}
        </button>
        <button class="btn btn-primary" :disabled="!canRun" @click="handleRun">
          <UiIcon name="spark" :size="15" :class="{ spin: running }" />
          {{ runLabel }}
        </button>
      </div>
    </div>

    <!-- ============================================ 空状态 -->
    <div
      v-if="!total"
      class="card card-pad empty"
      :class="{ 'is-drop': dragOver }"
      @dragenter.prevent="dragOver = true"
      @dragover.prevent="dragOver = true"
      @dragleave.prevent="dragOver = false"
      @drop="onDrop"
    >
      <span class="empty-icon"><UiIcon :name="emptyState.icon" :size="24" /></span>
      <p class="t-md t-2nd">{{ dragOver ? t('upscale.empty.dropHint') : emptyState.title }}</p>
      <p class="t-xs t-3rd empty-hint">{{ emptyState.hint }}</p>
      <div class="row gap-2">
        <button v-if="desktop && !running" class="btn btn-primary" :disabled="importing" @click="pickFiles">
          <UiIcon name="upload" :size="15" />{{ importing ? t('upscale.action.importing') : t('upscale.action.pick') }}
        </button>
        <button v-if="emptyState.action" class="btn btn-ghost" @click="goSettings">
          <UiIcon name="download" :size="15" />{{ t('upscale.action.downloadModel') }}
        </button>
      </div>
      <p v-if="model" class="t-xs t-3rd model-line">
        {{ t('upscale.empty.modelLine', { name: model.label }) }}
        <button class="link-btn" @click="revealModelDir">{{ t('upscale.action.gotoModelDir') }}</button>
      </p>
    </div>

    <template v-else>
      <!-- ============================================ 处理中 -->
      <div v-if="running" class="card card-pad running-bar">
        <span class="running-dot" />
        <span class="t-sm">
          <!--
            批量模式下一句话就跑完，期间拿不到逐张进度，
            所以只说「正在处理」并给出张数——显示「第 1 张」会让用户以为卡住了。
          -->
          {{ t('upscale.running.text', { count: readyCount || total }) }}
          <template v-if="etaText"> · {{ etaText }}</template>
        </span>
        <div class="progress-track"><span class="progress-fill" /></div>
      </div>

      <div class="up-body">
        <!-- ============================================ 待处理 -->
        <section class="card card-pad queue-col">
          <header class="col-head">
            <span class="panel-title">{{ t('upscale.queue.title') }}</span>
            <div class="row gap-1">
              <button
                class="icon-btn"
                :title="t('upscale.action.addMore')"
                :disabled="running || !desktop"
                @click="pickFiles"
              >
                <UiIcon name="plus" :size="15" />
              </button>
              <button
                class="icon-btn"
                :title="t('upscale.action.clearQueue')"
                :disabled="running || !upscale.queue.length"
                @click="upscale.clearQueue()"
              >
                <UiIcon name="trash" :size="15" />
              </button>
            </div>
          </header>

          <ul v-if="upscale.pending.length" class="img-grid">
            <li v-for="(image, index) in upscale.pending" :key="image.id" class="img-cell">
              <!-- 队列格子小，256 足够 -->
              <UiSmartImage :image="image" :icon-size="16" :thumb-edge="256" />
              <div class="img-mask">
                <span v-if="sizeMap[image.id]" class="img-size">
                  {{ sizeMap[image.id].w }}×{{ sizeMap[image.id].h }}
                </span>
                <button
                  class="icon-btn is-float"
                  :title="t('upscale.action.runOne')"
                  :disabled="running || !image.path"
                  @click="runOne(image, index)"
                >
                  <UiIcon name="spark" :size="14" />
                </button>
                <button
                  class="icon-btn is-float"
                  :title="t('upscale.action.removeOne')"
                  :disabled="running"
                  @click="upscale.removeFromQueue(image.id)"
                >
                  <UiIcon name="close" :size="14" />
                </button>
              </div>
            </li>
          </ul>
          <p v-else class="col-empty">
            {{ upscale.queue.length ? t('upscale.queue.emptyDone') : t('upscale.queue.emptyCleared') }}
          </p>
        </section>

        <!-- ============================================ 产物 -->
        <section class="card card-pad result-col">
          <header class="col-head">
            <span class="panel-title">{{ t('upscale.result.title') }}</span>
            <span v-if="upscale.results.length" class="t-xs t-3rd">
              {{ t('upscale.result.count', { count: upscale.results.length }) }}<template v-if="backendUsed"> · {{ backendUsed }}</template>
              · {{ t('upscale.result.switchHint') }}
            </span>
          </header>

          <template v-if="upscale.results.length && comparePair">
            <!-- 对比区：原图与产物并排 -->
            <div class="compare">
              <div class="compare-side">
                <span class="compare-tag">{{ t('upscale.compare.source') }}</span>
                <div class="compare-box">
                  <!-- 对比区是本页最大的图：原图可能是 126MB 的 8192² 超分产物，
                       这里必须走缩略图，否则打开超分页就会卡住 -->
                  <UiSmartImage
                    v-if="comparePair.source"
                    :image="comparePair.source"
                    :icon-size="24"
                    :eager="true"
                    :thumb-edge="1024"
                  />
                  <span v-else class="t-xs t-3rd">{{ t('upscale.compare.sourceGone') }}</span>
                </div>
                <p v-if="comparePair.source && sizeMap[comparePair.source.id]" class="t-xs t-3rd compare-dim">
                  {{ sizeMap[comparePair.source.id].w }} × {{ sizeMap[comparePair.source.id].h }}
                </p>
              </div>
              <span class="compare-arrow"><UiIcon name="chevron-right" :size="18" /></span>
              <div class="compare-side">
                <span class="compare-tag is-out">{{ t('upscale.compare.result') }}</span>
                <div class="compare-box is-out">
                  <UiSmartImage :image="comparePair.result" :icon-size="24" :eager="true" :thumb-edge="1024" />
                </div>
                <p v-if="sizeMap[comparePair.result.id]" class="t-xs t-accent compare-dim">
                  {{ sizeMap[comparePair.result.id].w }} × {{ sizeMap[comparePair.result.id].h }}
                </p>
              </div>
            </div>

            <div class="row gap-2 result-actions">
              <button class="btn btn-ghost" @click="downloadResult(comparePair.result)">
                <UiIcon name="download" :size="15" />{{ t('upscale.action.download') }}
              </button>
              <button class="btn btn-ghost" @click="revealResult(comparePair.result)">
                <UiIcon name="folder-open" :size="15" />{{ t('upscale.action.revealFolder') }}
              </button>
              <button class="btn btn-ghost" @click="upscale.clearResults()">
                <UiIcon name="trash" :size="15" />{{ t('upscale.action.clearResults') }}
              </button>
            </div>

            <!-- 产物缩略图 -->
            <ul class="img-grid thumbs">
              <li
                v-for="(image, index) in upscale.results"
                :key="image.id"
                class="img-cell"
                :class="{ 'is-active': index === compareIndex }"
                @click="compareIndex = index"
              >
                <UiSmartImage :image="image" :icon-size="16" :thumb-edge="256" />
              </li>
            </ul>
          </template>

          <p v-else class="col-empty">{{ t('upscale.result.empty') }}</p>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.up {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px 20px 20px;
  background: var(--bg-app);
  overflow-y: auto;
}
.up-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex: none;
}
.up-title {
  margin: 0 0 3px;
  font-size: var(--fs-16);
  font-weight: 650;
}
.up-sub {
  margin: 0;
  font-size: var(--fs-12);
  color: var(--text-tertiary);
}

/* ---------- 参数与操作条 ---------- */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  flex: none;
}
.tool-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
}
.tool-label {
  font-size: var(--fs-12);
  font-weight: 600;
  color: var(--text-secondary);
}
.scale-group {
  display: flex;
  gap: 4px;
  padding: 3px;
  border-radius: var(--r-md);
  background: var(--bg-muted);
}
.scale-btn {
  min-width: 46px;
  height: 26px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--fs-12);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.scale-btn:hover:not(:disabled) {
  background: var(--bg-surface);
  color: var(--text);
}
.scale-btn.is-active {
  background: var(--accent);
  color: #fff;
}
.scale-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.scale-fixed {
  min-width: 46px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 12px;
  border-radius: var(--r-md);
  background: var(--accent-soft);
  color: var(--accent-soft-fg);
  font-size: var(--fs-13);
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.scale-note {
  min-width: 0;
}

/* ---------- 空状态 ---------- */
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 48px 24px;
  text-align: center;
  border-style: dashed;
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.empty.is-drop {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.empty-icon {
  color: var(--text-faint);
}
.empty-hint {
  max-width: 52ch;
  line-height: 1.65;
}
.model-line {
  margin: 4px 0 0;
}

/* ---------- 处理中 ---------- */
.running-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
}
.running-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  animation: pulse-soft 1.3s ease-in-out infinite;
  flex: none;
}
.progress-track {
  flex: 1;
  height: 4px;
  border-radius: 999px;
  background: var(--bg-muted);
  overflow: hidden;
}
.progress-fill {
  display: block;
  height: 100%;
  width: 34%;
  border-radius: 999px;
  background: var(--brand-grad);
  animation: slide 1.3s var(--ease) infinite;
}
@keyframes slide {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(300%);
  }
}

/* ---------- 主体两栏 ---------- */
.up-body {
  display: grid;
  grid-template-columns: minmax(260px, 340px) 1fr;
  gap: 14px;
  align-items: start;
  min-height: 0;
}
@media (max-width: 980px) {
  .up-body {
    grid-template-columns: 1fr;
  }
}
.col-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}
.col-empty {
  margin: 0;
  padding: 28px 0;
  text-align: center;
  font-size: var(--fs-12);
  color: var(--text-tertiary);
}

/* ---------- 图片网格 ---------- */
.img-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.img-cell {
  position: relative;
  aspect-ratio: 1;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  overflow: hidden;
  background: var(--bg-muted);
  cursor: pointer;
  transition: border-color var(--dur) var(--ease);
}
.img-cell:hover {
  border-color: var(--border-strong);
}
.img-cell.is-active {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent-ring);
}
.img-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 4px;
  padding: 5px;
  background: linear-gradient(to top, rgb(0 0 0 / 62%) 0%, transparent 58%);
  opacity: 0;
  transition: opacity var(--dur) var(--ease);
}
.img-cell:hover .img-mask {
  opacity: 1;
}
.img-size {
  position: absolute;
  top: 5px;
  left: 5px;
  padding: 1px 5px;
  border-radius: var(--r-full);
  background: rgb(0 0 0 / 55%);
  color: #fff;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

/* ---------- 对比区 ---------- */
.compare {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}
.compare-side {
  min-width: 0;
}
.compare-tag {
  display: inline-block;
  margin-bottom: 6px;
  padding: 2px 8px;
  border-radius: var(--r-full);
  background: var(--bg-muted);
  color: var(--text-tertiary);
  font-size: var(--fs-11);
}
.compare-tag.is-out {
  background: var(--accent-soft);
  color: var(--accent-soft-fg);
}
.compare-box {
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  max-height: 340px;
  margin: 0 auto;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--canvas);
  overflow: hidden;
}
.compare-box :deep(.smart) {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.compare-box.is-out {
  border-color: var(--accent-soft);
}
.compare-dim {
  margin: 6px 0 0;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.compare-arrow {
  color: var(--text-faint);
}
.result-actions {
  margin-bottom: 12px;
}
.thumbs {
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
</style>

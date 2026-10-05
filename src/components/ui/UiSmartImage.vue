<script setup lang="ts">
import { t } from "../../i18n";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import type { GeneratedImage } from "../../types";
import { displayUrl, warmThumbnail } from "../../platform/media";
import UiIcon from "./UiIcon.vue";

/**
 * 智能图片：解析地址 → 懒加载 → 加载态 / 失败兜底。
 *
 * # 为什么不直接 `loading="lazy"`
 *
 * 原生 `loading="lazy"` 只推迟**网络请求**，但我们的地址是 `asset://`——
 * 文件在本地磁盘上，「请求」几乎立刻完成，真正贵的是后面的
 * **解码**（8192² 的 PNG 解码峰值 256MB，挤在渲染进程主线程上）。
 * 原生 lazy 完全不管解码，于是滚到哪解到哪，一屏几十张一起解码
 * 就把整个软件卡住。
 *
 * 因此这里自己用 `IntersectionObserver` 控制：
 * **只有真正进入视口才去取地址**（缩略图），远处的一律不碰。
 * 再叠加 `decoding="async"`，让解码也离开主线程。
 *
 * # 为什么默认走缩略图
 *
 * `images/` 里有 126MB 的 8192² 超分产物。列表卡片只有 224px 宽，
 * 直接加载原图等于为了 224px 的显示解码 256MB。
 * 传 `thumbEdge` 即启用缩略图（512px JPEG，几十 KB）；
 * 大图查看器的 1:1 模式传 `thumbEdge: 0` 拿原图。
 */
const props = withDefaults(
  defineProps<{
    image: GeneratedImage | null | undefined;
    alt?: string;
    /** 是否按图片原始比例展示（默认填充容器） */
    contain?: boolean;
    iconSize?: number;
    /**
     * 缩略图长边（像素）。省略或 0 = 加载原图。
     * 列表 / 卡片 / 缩略图条一律要传；只有「让用户看原图」的地方才传 0。
     *
     * **小图会自动被 Rust 判为「不值得缩」并直接回退原图**（实测 1.7MB 的图
     * 直接解码只要 7ms，走管线反而 577ms）。所以这里传什么都不影响小图。
     */
    thumbEdge?: number;
    /** 跳过视口观察立即加载（首屏关键图、灯箱） */
    eager?: boolean;
    /**
     * 渐进式加载的「先出图」尺寸。
     *
     * 传了就先加载这个小尺寸（通常已缓存，毫秒级）立刻显示，
     * 再在后台换 `thumbEdge` 的高清图。
     * **灯箱必须用**：1024 缩略图不预生成时，点开一张 126MB 的图要现解码 8 秒，
     * 期间一片空白；先垫一张 512 的小图则是「立刻看到模糊图 → 逐渐变清晰」。
     */
    previewEdge?: number;
    /**
     * 本图加载完后，后台预热这个尺寸的缩略图。
     *
     * 给「这张图很可能会被点开看大图」的场景用：历史卡片传 1024，
     * 用户滚到它时就把灯箱要用的尺寸生成好，点开即是毫秒级。
     * **不传就别预热**——后台解码是要花 CPU 的，别无条件触发。
     */
    warmEdge?: number;
  }>(),
  {
    alt: "",
    contain: false,
    iconSize: 22,
    thumbEdge: 512,
    eager: false,
    previewEdge: 0,
    warmEdge: 0,
  },
);

const emit = defineEmits<{ ready: [image: GeneratedImage]; failed: [] }>();

const src = ref("");
const failed = ref(false);
const loading = ref(true);
/** 是否已经进入视口（未进入则完全不取地址） */
const visible = ref(false);
/** 渐进加载的「垫底小图」地址；有值时垫在高清图下面 */
const previewSrc = ref("");

/**
 * 是否需要 grid 叠放两张图。
 *
 * 只在**垫底图确实会渲染**时才叠：高清图已就位（或已失败）时垫底图不显示，
 * 此时加 grid 只是白加一层。
 */
const showStack = computed(() => Boolean(previewSrc.value) && (!src.value || failed.value));
/** <img> 节点引用：用来兜住「图片已在缓存、`load` 事件不会再触发」的情况 */
const imgEl = ref<HTMLImageElement | null>(null);
/** 容器引用，IntersectionObserver 的观察目标 */
const rootEl = ref<HTMLElement | null>(null);

let observer: IntersectionObserver | null = null;
/** 递增令牌：丢弃过期请求的结果，避免快速切换时旧地址覆盖新图 */
let token = 0;
/** 已经回退到原图过一次就不再重试，否则原图也失败时 <img> 会反复报错 */
let fellBackToOriginal = false;

async function resolve() {
  const current = ++token;
  failed.value = false;
  loading.value = true;
  if (!props.image) {
    src.value = "";
    previewSrc.value = "";
    loading.value = false;
    return;
  }
  if (!visible.value) {
    // 还没进视口：先清空，等 observe 触发再来取
    src.value = "";
    return;
  }

  // 渐进加载：先垫一张小图（多半已缓存），再取高清。
  //
  // **1:1 模式（thumbEdge=0）同样要垫底**：那里恰恰是最坏情况——
  // 8192² 的原图 126MB，现场解码要好几秒。垫着 1024 缩略图，
  // 用户看到的是「清晰的图 → 1:1 后逐渐变细腻」，而不是「点一下 → 空白等待」。
  const wantPreview = props.previewEdge > 0 && props.previewEdge !== props.thumbEdge;
  if (wantPreview) {
    const small = await displayUrl(props.image, props.previewEdge);
    if (current !== token) return;
    if (small) previewSrc.value = small;
  } else {
    previewSrc.value = "";
  }

  const url = await displayUrl(props.image, props.thumbEdge);
  // 期间可能已经切到别的图了，丢弃这次的结果
  if (current !== token) return;
  if (!url) {
    // 高清失败但有垫底小图 → 继续用小图显示，别让用户什么都看不到
    if (previewSrc.value) {
      loading.value = false;
      return;
    }
    failed.value = true;
    loading.value = false;
    emit("failed");
    return;
  }
  // 「已经显示着这张图」→ 收尾，不要留下永远转圈的 loading。
  //
  // 背景：绝大多数图（≤8MB）缩略图与原图是**同一个 URL**
  // （`thumbnailUrl` 返回 null → `displayUrl` 回退 `fileUrl(path)`）。
  // 于是「适应窗口 ⇄ 1:1」来回切换时 `src` 根本没变：
  // `<img>` 不会重新触发 `load`，`watch(src)` 也不会触发，
  // 而 `loading` 只由这两者清除 —— 结果是**转圈动画永远不消失**。
  //
  // 这也是「1:1 到底在加载什么」的答案：**什么都没加载**，
  // 它只是把 `loading` 置起来却没人负责关掉。
  if (previewSrc.value === url) previewSrc.value = "";
  applySrc(url);
}

/** 进入视口（或要求 eager）才开始观察/取图 */
function startObserving() {
  if (observer || !rootEl.value) return;
  // 不支持 IntersectionObserver 的环境（老 WebView）直接放行，
  // 否则图片永远不加载——宁可卡也不能什么都不显示。
  if (typeof IntersectionObserver === "undefined") {
    visible.value = true;
    void resolve();
    return;
  }
  observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      visible.value = true;
      observer?.disconnect();
      observer = null;
      void resolve();
    },
    // 提前 400px 开始加载：用户滚到时图已经就绪，看不到空白
    { rootMargin: "400px 0px" },
  );
  observer.observe(rootEl.value);
}

/** 不再需要观察时（组件复用给了别的图）收起 */
function stopObserving() {
  observer?.disconnect();
  observer = null;
}

watch(
  () => props.image,
  () => {
    // 换图时重置回退标记，否则上一张图的失败会让新图直接进 failed
    fellBackToOriginal = false;
    // eager 图常驻加载；懒加载图切到新图时重新等进视口，
    // 否则离开视口的图会在后台白白加载
    if (props.eager) {
      visible.value = true;
      void resolve();
    } else {
      visible.value = false;
      src.value = "";
      stopObserving();
      void nextTick(startObserving);
    }
  },
  { immediate: true, deep: false },
);

// eager 从 false 变 true（例如灯箱打开）时立即补加载
watch(
  () => props.eager,
  (eager) => {
    if (eager && !visible.value) {
      visible.value = true;
      stopObserving();
      void resolve();
    }
  },
);

/**
 * `thumbEdge` 变化时重新取地址（大图查看器的「1:1 ⇄ 适应窗口」就是靠它切换）。
 *
 * 少了这个 watch 会出现：点「1:1」后 `thumbEdge` 变成 0，但 `src` 还是原来的
 * 缩略图地址，**图片看起来毫无反应**。
 *
 * 注意这里**不先清空 `src`**：清空会让已经显示出来的图退回骨架屏，
 * 换来一段空白等待。保留旧图、让新图就位后再替换（`<img>` 换 src 时
 * 浏览器会保留旧帧直到新图解码完，视觉上是「逐渐变清晰」而不是「闪一下」）。
 */
watch(
  () => props.thumbEdge,
  () => {
    if (!visible.value || !props.image) return;
    loading.value = true;
    void resolve();
  },
);

onBeforeUnmount(stopObserving);

/**
 * src 变化后检查图片是否已经解码完成。
 *
 * 浏览器对**已在缓存**的图不会再触发 `load` 事件（`load` 只在首次解码时来一次），
 * 切换图集 / 列表复用组件时就会永远停在加载态。这里补一次主动判定：
 * `complete && naturalWidth > 0` 表示可用，直接收尾。
 */
function settleIfCached() {
  const el = imgEl.value;
  if (el && el.complete && el.naturalWidth > 0) onLoad();
}

watch(src, async () => {
  await nextTick();
  settleIfCached();
});

/**
 * 设定新地址，并在「地址没变」时立刻收尾。
 *
 * 所有会改 `src` 的地方都走这里，避免漏掉「URL 相同」这一支——
 * 那种情况下既没有 `load` 事件也没有 `watch` 触发，
 * `loading` 会永远停在 true（转圈动画不消失）。
 */
function applySrc(url: string) {
  if (url === src.value) {
    loading.value = false;
    return;
  }
  src.value = url;
}

function onError() {
  // 缩略图加载失败时退回原图再试一次：缩略图是优化，
  // 缓存被外部清理 / 编码失败都不该让图片显示不出来。
  // 必须用 fellBackToOriginal 兜住「原图也失败」的情况，否则 <img> 会反复报错。
  if (props.thumbEdge && props.image?.path && !fellBackToOriginal) {
    fellBackToOriginal = true;
    loading.value = true;
    void displayUrl(props.image, 0).then((url) => {
      if (url) applySrc(url);
      else markFailed();
    });
    return;
  }
  markFailed();
}

function markFailed() {
  failed.value = true;
  loading.value = false;
  emit("failed");
}

function onLoad() {
  loading.value = false;
  // 本图已就位，顺手把「可能会用到的更大尺寸」在后台生成掉。
  // 放在 onLoad 而不是 resolve：图片已经显示出来了，预热不影响观感。
  if (props.warmEdge > props.thumbEdge && props.image?.path) {
    warmThumbnail(props.image.path, props.warmEdge);
  }
  if (props.image) emit("ready", props.image);
}
</script>

<template>
  <div ref="rootEl" class="smart" :class="{ 'is-contain': contain, 'is-stacked': showStack }">
    <!-- 垫底小图：高清还没就位时先顶上，避免整片空白。
         高清 <img> 是绝对定位盖在它上面的，两者同尺寸所以不会错位。 -->
    <img
      v-if="previewSrc && (!src || failed)"
      class="smart-preview"
      :src="previewSrc"
      :alt="alt"
      decoding="async"
      draggable="false"
      aria-hidden="true"
    />
    <img
      v-if="src && !failed"
      ref="imgEl"
      :src="src"
      :alt="alt"
      loading="lazy"
      decoding="async"
      draggable="false"
      @error="onError"
      @load="onLoad"
    />
    <div v-else-if="!previewSrc" class="smart-fallback">
      <UiIcon name="image" :size="iconSize" />
    </div>
    <div
      v-if="loading && (src || previewSrc || !visible)"
      class="smart-loading"
      role="status"
      :aria-label="t('common.imageLoading')"
      :style="{ '--smart-icon': `${iconSize}px` }"
    >
      <UiIcon name="loader" :size="iconSize" class="smart-spinner" />
    </div>
  </div>
</template>

<style scoped>
.smart {
  position: relative;
  width: 100%;
  height: 100%;
  background: var(--bg-muted);
  overflow: hidden;
}
.smart img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
/*
 * 渐进加载的叠放方式：**grid 让两张图占同一格**，而不是 absolute。
 *
 * 别用 `position:absolute` 叠图——大图查看器给 `.smart` 的覆盖是
 * `width:auto; height:auto`，**容器尺寸完全靠流内的 <img> 撑起来**。
 * 一旦把高清图摘出文档流，容器就只剩垫底小图的尺寸，
 * 而 `object-fit:contain` 的高清图被甩到容器外——**大图彻底不显示**
 * （本机用 Edge 无头实测：塌成 100×80，正常应为 455×364）。
 *
 * grid 叠放两张图都留在流内，容器始终被真正要显示的那张撑开。
 */
.smart.is-stacked {
  display: grid;
}
.smart.is-stacked img {
  grid-area: 1 / 1;
}
/* 垫底小图轻微模糊，视觉上明确「这是一张待替换的预览」 */
.smart-preview {
  filter: blur(0.5px);
}
.smart.is-contain img {
  object-fit: contain;
}
.smart-fallback {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  color: var(--text-faint);
}
.smart-loading {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
  /* 光环尺寸跟着 iconSize 走（--smart-icon 由模板内联设置）。
     倍数压到 1.9 并给 26px 下限：16px 缩略图里 2.6 倍几乎撑满整格，反而笨重 */
  --smart-halo: max(26px, calc(var(--smart-icon, 22px) * 1.9));
}

/* 图标用强调色，和 fallback 的 --text-faint 拉开层次 */
.smart-spinner {
  color: var(--accent-soft-fg);
  animation: spin 0.9s linear infinite;
}

/* 呼吸光环：纯 CSS，不引入额外元素。
   scale + opacity 两段，幅度刻意压小——历史记录是密集网格，太跳会晕。 */
.smart-loading::before {
  content: "";
  position: absolute;
  width: var(--smart-halo);
  height: var(--smart-halo);
  border-radius: 50%;
  background: var(--accent-ring);
  animation: smart-breathe 1.8s var(--ease) infinite;
}

@keyframes smart-breathe {
  0%,
  100% {
    transform: scale(0.72);
    opacity: 0;
  }
  45% {
    transform: scale(1);
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .smart-spinner,
  .smart-loading::before {
    animation: none;
  }
  /* 不支持动画时给一个静态提示，别让界面看起来像卡死 */
  .smart-loading::before {
    transform: scale(0.9);
    opacity: 0.5;
  }
}
</style>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { remoteImageCandidates } from "../../services/promptRepo";
import UiIcon from "../ui/UiIcon.vue";

/**
 * 仓库案例图。
 * 图片直链来自 GitHub，国内时通时不通，所以按「官方直链 → 公共镜像」逐个退，
 * 全部失败才显示占位图标——不会出现浏览器的破图。
 *
 * 只接单个地址（内部展开成候选链）。之前接的是数组，调用方每次渲染都会传新数组字面量，
 * 导致候选链被判定为「变了」而不断重置重试游标，图永远加载不出来。
 */
const props = withDefaults(
  defineProps<{
    /** 原始图片地址，为空时直接显示占位 */
    source?: string;
    alt?: string;
    iconSize?: number;
    /** fill：铺满容器（卡片缩略图）；natural：按图片比例自适应（详情大图） */
    mode?: "fill" | "natural";
  }>(),
  { source: "", alt: "", iconSize: 22, mode: "fill" },
);

const candidates = computed(() => remoteImageCandidates(props.source));
const cursor = ref(0);
const failed = ref(false);
const loading = ref(true);

// 只跟着地址字符串走：地址不变就不会重置重试状态
watch(
  () => props.source,
  () => {
    cursor.value = 0;
    failed.value = false;
    loading.value = true;
  },
  { immediate: true },
);

const src = computed(() => candidates.value[cursor.value] ?? "");
/** 还没有可显示的图（加载中或全部候选都失败）：natural 模式下需要给容器撑个尺寸 */
const empty = computed(() => !src.value || failed.value || loading.value);

function onError() {
  if (cursor.value < candidates.value.length - 1) {
    cursor.value += 1;
    return;
  }
  failed.value = true;
  loading.value = false;
}
</script>

<template>
  <div class="remote" :class="[`is-${mode}`, { 'is-empty': empty }]">
    <img
      v-if="src && !failed"
      :src="src"
      :alt="alt"
      loading="lazy"
      draggable="false"
      @error="onError"
      @load="loading = false"
    />
    <div v-else class="remote-fallback">
      <UiIcon name="image" :size="iconSize" />
    </div>
    <div v-if="loading && src && !failed" class="remote-loading">
      <div class="skeleton remote-bar" />
    </div>
  </div>
</template>

<style scoped>
.remote {
  position: relative;
  width: 100%;
  height: 100%;
  background: var(--bg-muted);
  overflow: hidden;
}
.remote img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
/* 详情大图：不撑满容器，按图片自身比例显示，由容器的 max-height 兜住 */
.remote.is-natural {
  width: auto;
  height: auto;
  max-width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
/* 加载中 / 失败时撑出占位尺寸，避免骨架屏塌成 0 高 */
.remote.is-natural.is-empty {
  width: 100%;
  aspect-ratio: 4 / 3;
  max-height: 52vh;
}
.remote.is-natural img {
  width: auto;
  height: auto;
  max-width: 100%;
  object-fit: contain;
}
.remote-fallback {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  min-width: 84px;
  color: var(--text-faint);
}
.remote-loading {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
}
.remote-bar {
  width: 40%;
  height: 4px;
  border-radius: 999px;
}
</style>

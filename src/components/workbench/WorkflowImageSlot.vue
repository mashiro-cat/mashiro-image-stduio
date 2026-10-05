<script setup lang="ts">
import { computed, ref } from "vue";
import type { GeneratedImage } from "../../types";
import { t } from "../../i18n";
import UiIcon from "../ui/UiIcon.vue";
import UiSmartImage from "../ui/UiSmartImage.vue";

/** 单个图片输入槽位：一个工作流可以有多个 LoadImage 节点，每个槽位单独选图 */
const props = withDefaults(
  defineProps<{
    image: GeneratedImage | null;
    loading?: boolean;
    accept?: string;
  }>(),
  { loading: false, accept: "" },
);

const emit = defineEmits<{
  pick: [];
  drop: [files: File[]];
  remove: [];
}>();

const dragging = ref(false);

const displayName = computed(() => {
  const source = props.image?.path ?? props.image?.url ?? "";
  return source.split(/[\\/]/).pop() || t("workflow.image.selected");
});

function onDrop(event: DragEvent) {
  dragging.value = false;
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length) emit("drop", files);
}

function onDragOver(event: DragEvent) {
  event.preventDefault();
  dragging.value = true;
}
</script>

<template>
  <div
    class="slot-drop"
    :class="{ 'is-dragging': dragging, 'has-image': Boolean(image) }"
    @click="emit('pick')"
    @dragover="onDragOver"
    @dragleave="dragging = false"
    @drop.prevent="onDrop"
  >
    <template v-if="image">
      <div class="slot-thumb">
        <!-- 缩略图格子很小，256 足够 -->
        <UiSmartImage :image="image" :icon-size="16" :thumb-edge="256" />
      </div>
      <div class="slot-meta">
        <span class="slot-file t-ellipsis">{{ displayName }}</span>
        <button class="link-btn" @click.stop="emit('pick')">{{ t("workflow.image.replace") }}</button>
      </div>
      <button class="slot-x" :title="t('workflow.image.remove')" @click.stop="emit('remove')">
        <UiIcon name="close" :size="13" />
      </button>
    </template>

    <template v-else>
      <span class="slot-icon"><UiIcon name="upload" :size="16" :class="{ spin: loading }" /></span>
      <span class="slot-tip">{{ t("workflow.image.upload") }}</span>
      <span class="slot-sub">{{ accept || t("workflow.image.accept") }}</span>
    </template>
  </div>
</template>

<style scoped>
.slot-drop {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--r-md);
  background: var(--bg-subtle);
  cursor: pointer;
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.slot-drop:hover,
.slot-drop.is-dragging {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.slot-drop.has-image {
  border-style: solid;
  background: var(--bg-surface);
}
.slot-icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: var(--r-sm);
  background: var(--bg-muted);
  color: var(--text-tertiary);
}
.slot-tip {
  flex: 1;
  font-size: var(--fs-12);
  color: var(--text-secondary);
}
.slot-sub {
  font-size: 10.5px;
  color: var(--text-faint);
}
.slot-thumb {
  width: 46px;
  height: 46px;
  flex: none;
  border-radius: var(--r-sm);
  overflow: hidden;
  border: 1px solid var(--border);
}
.slot-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.slot-file {
  font-size: var(--fs-11);
  color: var(--text-secondary);
}
.slot-x {
  position: absolute;
  top: 6px;
  right: 6px;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
}
.slot-x:hover {
  background: var(--danger-soft);
  color: var(--danger);
}
.link-btn {
  align-self: flex-start;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--accent);
  font-size: var(--fs-11);
  cursor: pointer;
}
.link-btn:hover {
  text-decoration: underline;
}
</style>

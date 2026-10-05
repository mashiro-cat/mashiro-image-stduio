<script setup lang="ts">
import { ref } from "vue";
import type { GeneratedImage } from "../../types";
import { t } from "../../i18n";
import UiIcon from "../ui/UiIcon.vue";
import UiSmartImage from "../ui/UiSmartImage.vue";

const props = withDefaults(
  defineProps<{
    images: GeneratedImage[];
    max?: number;
    loading?: boolean;
    label?: string;
  }>(),
  { max: 4, loading: false, label: "" },
);

const emit = defineEmits<{
  pick: [];
  drop: [files: File[]];
  remove: [id: string];
  clear: [];
}>();

const dragging = ref(false);

function onDrop(event: DragEvent) {
  dragging.value = false;
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length) emit("drop", files);
}

function onDragOver(event: DragEvent) {
  event.preventDefault();
  dragging.value = true;
}

function onDragLeave() {
  dragging.value = false;
}
</script>

<template>
  <section class="refs">
    <div class="row-between">
      <span class="panel-title">{{ label || t("studio.reference.label") }}</span>
      <span class="row gap-1">
        <span class="t-xs t-3rd">{{ t("studio.reference.count", { current: images.length, max }) }}</span>
        <button v-if="images.length" class="link-btn" @click="emit('clear')">{{ t("studio.reference.clear") }}</button>
      </span>
    </div>

    <div
      class="dropzone"
      :class="{ 'is-dragging': dragging, 'has-items': images.length }"
      @click="emit('pick')"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop.prevent="onDrop"
    >
      <template v-if="!images.length">
        <span class="dz-icon"><UiIcon name="upload" :size="18" :class="{ spin: loading }" /></span>
        <span class="dz-title">{{ t("studio.reference.upload") }}</span>
        <span class="dz-sub">{{ t("studio.reference.formats", { max }) }}</span>
      </template>

      <div v-else class="thumb-grid">
        <div v-for="image in images" :key="image.id" class="thumb-item">
          <!-- 56px 的格子，256 足够（2x 屏仍清晰），没必要用 512 -->
          <UiSmartImage :image="image" :icon-size="16" :thumb-edge="256" />
          <button class="thumb-x" :title="t('studio.reference.remove')" @click.stop="emit('remove', image.id)">
            <UiIcon name="close" :size="12" />
          </button>
        </div>
        <button
          v-if="images.length < max"
          class="thumb-add"
          :title="t('studio.reference.addMore')"
          @click.stop="emit('pick')"
        >
          <UiIcon name="plus" :size="16" />
        </button>
      </div>
    </div>
    <p class="field-hint">{{ t("studio.reference.hint") }}</p>
  </section>
</template>

<style scoped>
.refs {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 118px;
  padding: 14px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--r-md);
  background: var(--bg-subtle);
  color: var(--text-tertiary);
  cursor: pointer;
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.dropzone:hover,
.dropzone.is-dragging {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.dropzone.has-items {
  padding: 10px;
  border-style: solid;
  background: var(--bg-surface);
}
.dz-icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: var(--r-sm);
  background: var(--bg-muted);
}
.dz-title {
  font-size: var(--fs-12);
  font-weight: 550;
  color: var(--text-secondary);
}
.dz-sub {
  font-size: 10.5px;
  color: var(--text-faint);
}
.thumb-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 7px;
  width: 100%;
}
.thumb-item {
  position: relative;
  aspect-ratio: 1;
  border-radius: var(--r-sm);
  overflow: hidden;
  border: 1px solid var(--border);
}
.thumb-x {
  position: absolute;
  top: 3px;
  right: 3px;
  z-index: 2;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 50%;
  background: rgba(12, 14, 20, 0.7);
  color: #fff;
  cursor: pointer;
}
.thumb-add {
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  border: 1px dashed var(--border-strong);
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
}
.thumb-add:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.link-btn {
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--accent);
  font-size: var(--fs-12);
  cursor: pointer;
}
.link-btn:hover {
  text-decoration: underline;
}
</style>

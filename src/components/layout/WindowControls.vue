<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { t } from "../../i18n";
import UiIcon from "../ui/UiIcon.vue";
import {
  closeWindow,
  minimizeWindow,
  needsWindowControls,
  onWindowResized,
  queryMaximized,
  toggleMaximizeWindow,
} from "../../platform/window";

/**
 * 自绘窗口按钮（Windows / Linux）。
 * macOS 保留原生红绿灯，浏览器预览模式没有窗口可操作 —— 这两种情况都不渲染。
 */
const visible = needsWindowControls();
const maximized = ref(false);
let unlisten: (() => void) | null = null;

async function sync() {
  maximized.value = await queryMaximized();
}

/** 切换后立刻同步图标，不等 resize 事件（全屏切换时事件不一定先到） */
async function toggle() {
  await toggleMaximizeWindow();
  await sync();
}

onMounted(async () => {
  if (!visible) return;
  await sync();
  unlisten = await onWindowResized(() => void sync());
});

onBeforeUnmount(() => unlisten?.());
</script>

<template>
  <!-- 按钮组整体排除在拖拽区之外，避免误拖窗口 -->
  <div v-if="visible" class="win-controls" data-tauri-drag-region="false">
    <button class="win-btn" type="button" :title="t('nav.window.minimize')" @click="minimizeWindow()">
      <UiIcon name="minimize" :size="15" :stroke-width="1.5" />
    </button>
    <button
      class="win-btn"
      type="button"
      :title="maximized ? t('nav.window.restore') : t('nav.window.maximize')"
      @click="toggle()"
    >
      <UiIcon :name="maximized ? 'restore' : 'maximize'" :size="15" :stroke-width="1.5" />
    </button>
    <button class="win-btn is-close" type="button" :title="t('nav.window.close')" @click="closeWindow()">
      <UiIcon name="close" :size="15" :stroke-width="1.5" />
    </button>
  </div>
</template>

<style scoped>
.win-controls {
  display: flex;
  align-items: stretch;
  flex: none;
  height: 100%;
}
.win-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: var(--titlebar-h);
  border: 0;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.win-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.win-btn:active {
  background: var(--bg-muted);
}
.win-btn.is-close:hover {
  background: var(--danger);
  color: #fff;
}
.win-btn.is-close:active {
  background: var(--danger);
  color: #fff;
  filter: brightness(0.92);
}
</style>

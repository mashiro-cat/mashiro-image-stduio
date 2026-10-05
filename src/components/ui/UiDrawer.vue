<script setup lang="ts">
import { t } from "../../i18n";
import { onBeforeUnmount, watch } from "vue";
import UiIcon from "./UiIcon.vue";

const props = withDefaults(
  defineProps<{
    open: boolean;
    title?: string;
    subtitle?: string;
    width?: number;
  }>(),
  { title: "", subtitle: "", width: 420 },
);

const emit = defineEmits<{ "update:open": [value: boolean] }>();

function close() {
  emit("update:open", false);
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") close();
}

watch(
  () => props.open,
  (open) => {
    if (open) window.addEventListener("keydown", onKeydown);
    else window.removeEventListener("keydown", onKeydown);
  },
  { immediate: true },
);

onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="open" class="mask" @click.self="close">
        <aside class="drawer" :style="{ width: `${width}px` }">
          <header class="drawer-head">
            <div class="grow">
              <h3 class="drawer-title">{{ title }}</h3>
              <p v-if="subtitle" class="drawer-sub">{{ subtitle }}</p>
            </div>
            <button class="icon-btn" :title="t('common.closeTitle')" @click="close">
              <UiIcon name="close" :size="17" />
            </button>
          </header>
          <div class="drawer-body">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="drawer-foot">
            <slot name="footer" />
          </footer>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 880;
  display: flex;
  justify-content: flex-end;
  background: rgba(14, 16, 22, 0.34);
  backdrop-filter: blur(2px);
}
[data-theme="dark"] .mask {
  background: rgba(0, 0, 0, 0.55);
}
.drawer {
  height: 100%;
  max-width: 92vw;
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  border-left: 1px solid var(--border);
  box-shadow: var(--shadow-lg);
}
.drawer-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px 18px 14px;
  border-bottom: 1px solid var(--border);
}
.drawer-title {
  font-size: var(--fs-15);
  font-weight: 650;
}
.drawer-sub {
  margin-top: 3px;
  font-size: var(--fs-12);
  color: var(--text-tertiary);
}
.drawer-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px;
}
.drawer-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 13px 18px;
  border-top: 1px solid var(--border);
  background: var(--bg-subtle);
}

.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.22s var(--ease);
}
.drawer-enter-active .drawer,
.drawer-leave-active .drawer {
  transition: transform 0.26s var(--ease);
}
.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}
.drawer-enter-from .drawer,
.drawer-leave-to .drawer {
  transform: translateX(24px);
}
</style>

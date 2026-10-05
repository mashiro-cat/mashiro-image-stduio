<script setup lang="ts">
import { t } from "../../i18n";
import { onBeforeUnmount, watch } from "vue";
import UiIcon from "./UiIcon.vue";

const props = withDefaults(
  defineProps<{
    open: boolean;
    title?: string;
    description?: string;
    /** 容器最大宽度 */
    width?: number;
    /** 关闭时是否允许点击遮罩 */
    maskClosable?: boolean;
    /** 内容区滚动，适合长表单 */
    scrollable?: boolean;
  }>(),
  { title: "", description: "", width: 560, maskClosable: true, scrollable: true },
);

const emit = defineEmits<{ "update:open": [value: boolean]; close: [] }>();

function close() {
  emit("update:open", false);
  emit("close");
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
    <Transition name="modal">
      <div v-if="open" class="mask" @click.self="maskClosable && close()">
        <div class="modal" :style="{ maxWidth: `${width}px` }" role="dialog" aria-modal="true">
          <header v-if="title || $slots.header" class="modal-head">
            <slot name="header">
              <div class="grow">
                <h3 class="modal-title">{{ title }}</h3>
                <p v-if="description" class="modal-desc">{{ description }}</p>
              </div>
            </slot>
            <button class="icon-btn" :title="t('common.closeTitle')" @click="close">
              <UiIcon name="close" :size="17" />
            </button>
          </header>

          <div class="modal-body" :class="{ scrollable }">
            <slot />
          </div>

          <footer v-if="$slots.footer" class="modal-foot">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 900;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 5vh 24px;
  background: rgba(14, 16, 22, 0.42);
  backdrop-filter: blur(3px);
}
[data-theme="dark"] .mask {
  background: rgba(0, 0, 0, 0.6);
}
.modal {
  width: 100%;
  display: flex;
  flex-direction: column;
  max-height: 90vh;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}
.modal-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 18px 20px 14px;
  border-bottom: 1px solid var(--border);
}
.modal-title {
  font-size: var(--fs-16);
  font-weight: 650;
  letter-spacing: -0.01em;
}
.modal-desc {
  margin-top: 3px;
  font-size: var(--fs-12);
  color: var(--text-secondary);
}
.modal-body {
  padding: 20px;
  min-height: 0;
}
.modal-body.scrollable {
  overflow-y: auto;
}
.modal-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid var(--border);
  background: var(--bg-subtle);
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s var(--ease);
}
.modal-enter-active .modal,
.modal-leave-active .modal {
  transition: transform 0.24s var(--ease), opacity 0.24s var(--ease);
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .modal {
  transform: scale(0.97) translateY(10px);
}
.modal-leave-to .modal {
  transform: scale(0.98) translateY(6px);
  opacity: 0;
}
</style>

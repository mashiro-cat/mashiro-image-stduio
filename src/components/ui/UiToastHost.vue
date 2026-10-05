<script setup lang="ts">
import { t } from "../../i18n";
import { storeToRefs } from "pinia";
import { useRouter } from "vue-router";
import type { ToastItem } from "../../types";
import { useUiStore } from "../../stores/ui";
import UiIcon from "./UiIcon.vue";

const ui = useUiStore();
const router = useRouter();
const { toasts } = storeToRefs(ui);

const ICON: Record<string, string> = {
  success: "check",
  error: "alert",
  warning: "alert",
  info: "info",
};

function runAction(toast: ToastItem) {
  if (!toast.action) return;
  if (toast.action.kind === "debug") ui.openDebugDrawer();
  else if (toast.action.kind === "settings") router.push("/settings");
  ui.dismiss(toast.id);
}
</script>

<template>
  <Teleport to="body">
    <div class="toast-host">
      <TransitionGroup name="toast">
        <div v-for="toast in toasts" :key="toast.id" class="toast" :class="`is-${toast.type}`">
          <span class="toast-icon">
            <UiIcon :name="ICON[toast.type] ?? 'info'" :size="16" />
          </span>
          <div class="grow">
            <p class="toast-title">{{ toast.title }}</p>
            <p v-if="toast.message" class="toast-msg">{{ toast.message }}</p>
            <button v-if="toast.action" class="toast-action" @click="runAction(toast)">
              <UiIcon :name="toast.action.kind === 'debug' ? 'bug' : 'key'" :size="12" />
              {{ toast.action.label }}
            </button>
          </div>
          <button class="toast-close" :title="t('common.closeTitle')" @click="ui.dismiss(toast.id)">
            <UiIcon name="close" :size="14" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-host {
  position: fixed;
  top: calc(var(--titlebar-h) + 12px);
  right: 16px;
  z-index: 1200;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 340px;
  max-width: calc(100vw - 32px);
  pointer-events: none;
}
.toast {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 12px 12px 14px;
  border-radius: var(--r-lg);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-pop);
  pointer-events: auto;
}
.toast-icon {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: var(--r-full);
  flex: none;
  margin-top: 1px;
}
.is-success .toast-icon {
  background: var(--success-soft);
  color: var(--success);
}
.is-error .toast-icon {
  background: var(--danger-soft);
  color: var(--danger);
}
.is-warning .toast-icon {
  background: var(--warning-soft);
  color: var(--warning);
}
.is-info .toast-icon {
  background: var(--info-soft);
  color: var(--info);
}
.toast-title {
  font-size: var(--fs-13);
  font-weight: 600;
  line-height: 1.45;
}
.toast-msg {
  margin-top: 2px;
  font-size: var(--fs-12);
  color: var(--text-secondary);
  line-height: 1.5;
  word-break: break-word;
}
.toast-close {
  flex: none;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
}
.toast-action {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 8px;
  padding: 4px 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-full);
  background: var(--bg-surface);
  color: var(--text);
  font-size: var(--fs-11);
  font-weight: 550;
  cursor: pointer;
  transition: border-color var(--dur) var(--ease), color var(--dur) var(--ease);
}
.toast-action:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.toast-close:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.24s var(--ease), transform 0.24s var(--ease);
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(18px) scale(0.98);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(18px);
}
.toast-move {
  transition: transform 0.24s var(--ease);
}
</style>

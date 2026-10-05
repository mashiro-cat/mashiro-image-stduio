<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useUiStore } from "../../stores/ui";

const ui = useUiStore();
const { confirmState } = storeToRefs(ui);
</script>

<template>
  <Teleport to="body">
    <Transition name="confirm">
      <div v-if="confirmState.open" class="mask" @click.self="ui.resolveConfirm(false)">
        <div class="box">
          <h3 class="title">{{ confirmState.title }}</h3>
          <p v-if="confirmState.message" class="message">{{ confirmState.message }}</p>
          <div class="actions">
            <button class="btn" @click="ui.resolveConfirm(false)">{{ confirmState.cancelText }}</button>
            <button
              class="btn"
              :class="confirmState.tone === 'danger' ? 'btn-danger-solid' : 'btn-primary'"
              @click="ui.resolveConfirm(true)"
            >
              {{ confirmState.confirmText }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 1300;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(14, 16, 22, 0.42);
  backdrop-filter: blur(3px);
}
[data-theme="dark"] .mask {
  background: rgba(0, 0, 0, 0.6);
}
.box {
  width: 100%;
  max-width: 400px;
  padding: 22px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  box-shadow: var(--shadow-lg);
}
.title {
  font-size: var(--fs-15);
  font-weight: 650;
}
.message {
  margin-top: 8px;
  font-size: var(--fs-13);
  color: var(--text-secondary);
  line-height: 1.6;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}
.btn-danger-solid {
  background: var(--danger);
  border-color: transparent;
  color: #fff;
}
.btn-danger-solid:hover {
  background: var(--danger);
  filter: brightness(1.08);
  border-color: transparent;
}

.confirm-enter-active,
.confirm-leave-active {
  transition: opacity 0.18s var(--ease);
}
.confirm-enter-active .box,
.confirm-leave-active .box {
  transition: transform 0.2s var(--ease), opacity 0.2s var(--ease);
}
.confirm-enter-from,
.confirm-leave-to {
  opacity: 0;
}
.confirm-enter-from .box {
  transform: scale(0.96);
}
.confirm-leave-to .box {
  opacity: 0;
}
</style>

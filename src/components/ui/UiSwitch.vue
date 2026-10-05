<script setup lang="ts">
/**
 * 开关控件。
 * 刻意不使用 <label> 包裹 <button> 的写法——label 会把点击再转发给关联控件，
 * 在部分内核下会出现「一次点击触发两次切换」，表现为开关点不动。
 * 这里用单一容器承接点击，仅派发一次，并补齐 role=switch 与键盘操作。
 */
const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    label?: string;
    hint?: string;
    disabled?: boolean;
    /** 无可见文字时供读屏使用 */
    ariaLabel?: string;
  }>(),
  { label: "", hint: "", disabled: false, ariaLabel: "" },
);

const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();

function toggle() {
  if (props.disabled) return;
  emit("update:modelValue", !props.modelValue);
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    toggle();
  }
}
</script>

<template>
  <div class="switch-row" :class="{ 'is-disabled': disabled, 'is-on': modelValue }" @click="toggle">
    <span v-if="label || hint" class="switch-text">
      <span class="switch-label">{{ label }}</span>
      <span v-if="hint" class="switch-hint">{{ hint }}</span>
    </span>
    <span
      class="switch"
      :class="{ 'is-on': modelValue }"
      role="switch"
      :tabindex="disabled ? -1 : 0"
      :aria-checked="modelValue"
      :aria-disabled="disabled"
      :aria-label="ariaLabel || label || undefined"
      @keydown="onKeydown"
    >
      <span class="knob" />
    </span>
  </div>
</template>

<style scoped>
.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  cursor: pointer;
  user-select: none;
}
.switch-row.is-disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.switch-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.switch-label {
  font-size: var(--fs-13);
  font-weight: 500;
}
.switch-hint {
  font-size: var(--fs-11);
  color: var(--text-tertiary);
  line-height: 1.5;
}
.switch {
  flex: none;
  position: relative;
  display: block;
  width: 40px;
  height: 23px;
  border-radius: var(--r-full);
  background: var(--border-strong);
  transition: background var(--dur) var(--ease);
}
.switch.is-on {
  background: var(--accent);
}
.switch:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 17px;
  height: 17px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.24);
  transition: transform 0.2s var(--ease);
}
.switch.is-on .knob {
  transform: translateX(17px);
}
</style>

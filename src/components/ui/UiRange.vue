<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    modelValue: number;
    min?: number;
    max?: number;
    step?: number;
    suffix?: string;
  }>(),
  { min: 0, max: 100, step: 1, suffix: "" },
);

const emit = defineEmits<{ "update:modelValue": [value: number] }>();

function onInput(event: Event) {
  emit("update:modelValue", Number((event.target as HTMLInputElement).value));
}
</script>

<template>
  <div class="range">
    <input
      class="range-input"
      type="range"
      :min="min"
      :max="max"
      :step="step"
      :value="modelValue"
      :style="{ '--fill': `${((modelValue - min) / Math.max(1, max - min)) * 100}%` }"
      @input="onInput"
    />
    <span class="range-value">{{ modelValue }}{{ suffix }}</span>
  </div>
</template>

<style scoped>
.range {
  display: flex;
  align-items: center;
  gap: 12px;
}
.range-input {
  flex: 1;
  height: 20px;
  appearance: none;
  background: transparent;
  cursor: pointer;
}
.range-input::-webkit-slider-runnable-track {
  height: 5px;
  border-radius: 999px;
  background: linear-gradient(
    to right,
    var(--accent) 0%,
    var(--accent) var(--fill),
    var(--bg-muted) var(--fill),
    var(--bg-muted) 100%
  );
}
.range-input::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  margin-top: -4.5px;
  border-radius: 50%;
  background: var(--bg-surface);
  border: 2px solid var(--accent);
  box-shadow: var(--shadow-xs);
  transition: transform 0.12s var(--ease);
}
.range-input:active::-webkit-slider-thumb {
  transform: scale(1.12);
}
.range-value {
  min-width: 42px;
  text-align: right;
  font-size: var(--fs-12);
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}
</style>

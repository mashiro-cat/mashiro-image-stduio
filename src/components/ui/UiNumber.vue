<script setup lang="ts">
import { computed } from "vue";
import UiIcon from "./UiIcon.vue";

const props = withDefaults(
  defineProps<{
    modelValue: number;
    min?: number;
    max?: number;
    step?: number;
    suffix?: string;
  }>(),
  { min: 1, max: 10, step: 1, suffix: "" },
);

const emit = defineEmits<{ "update:modelValue": [value: number] }>();

const canDec = computed(() => props.modelValue > props.min);
const canInc = computed(() => props.modelValue < props.max);

function set(value: number) {
  const clamped = Math.min(props.max, Math.max(props.min, Math.round(value)));
  emit("update:modelValue", clamped);
}

function onInput(event: Event) {
  const raw = Number((event.target as HTMLInputElement).value);
  set(Number.isFinite(raw) ? raw : props.min);
}
</script>

<template>
  <div class="stepper">
    <button type="button" class="stepper-btn" :disabled="!canDec" @click="set(modelValue - step)">
      <UiIcon name="minus" :size="15" />
    </button>
    <div class="stepper-value">
      <input :value="modelValue" type="number" :min="min" :max="max" @change="onInput" />
      <span v-if="suffix" class="stepper-suffix">{{ suffix }}</span>
    </div>
    <button type="button" class="stepper-btn" :disabled="!canInc" @click="set(modelValue + step)">
      <UiIcon name="plus" :size="15" />
    </button>
  </div>
</template>

<style scoped>
.stepper {
  display: flex;
  align-items: center;
  gap: 6px;
}
.stepper-btn {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: var(--r-sm);
  border: 1px solid var(--border-input);
  background: var(--bg-surface);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.stepper-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}
.stepper-btn:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}
.stepper-value {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 2px;
  flex: 1;
  height: 32px;
  border: 1px solid var(--border-input);
  border-radius: var(--r-sm);
  background: var(--bg-surface);
}
.stepper-value input {
  width: 34px;
  border: 0;
  background: transparent;
  text-align: center;
  font-size: var(--fs-13);
  font-weight: 600;
  -moz-appearance: textfield;
}
.stepper-value input::-webkit-outer-spin-button,
.stepper-value input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.stepper-value input:focus {
  outline: none;
}
.stepper-suffix {
  font-size: var(--fs-11);
  color: var(--text-tertiary);
}
</style>

<script setup lang="ts">
import UiIcon from "./UiIcon.vue";

interface Option {
  label: string;
  value: string;
  icon?: string;
  hint?: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: string;
    options: Option[];
    /** 等分宽度 */
    block?: boolean;
  }>(),
  { block: false },
);

const emit = defineEmits<{ "update:modelValue": [value: string] }>();
</script>

<template>
  <div class="segmented" :class="{ 'is-block': block }">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="segmented-item"
      :class="{ 'is-active': modelValue === option.value }"
      :title="option.hint"
      @click="emit('update:modelValue', option.value)"
    >
      <UiIcon v-if="option.icon" :name="option.icon" :size="14" />
      <span>{{ option.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.is-block {
  display: flex;
  width: 100%;
}
.is-block .segmented-item {
  flex: 1;
}
</style>

<script setup lang="ts">
import { t } from "../../i18n";
import { ref } from "vue";
import UiIcon from "./UiIcon.vue";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    placeholder?: string;
    /** 用于展示的默认掩码，避免明文回显真实密钥 */
    maskedHint?: string;
  }>(),
  { placeholder: "sk-...", maskedHint: "" },
);

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const visible = ref(false);

function toggle() {
  visible.value = !visible.value;
  if (!visible.value && document.activeElement instanceof HTMLInputElement) {
    document.activeElement.blur();
  }
}
</script>

<template>
  <div class="input-group">
    <UiIcon name="key" :size="14" class="secret-icon" />
    <input
      class="input"
      :type="visible ? 'text' : 'password'"
      :value="modelValue"
      :placeholder="placeholder"
      autocomplete="off"
      spellcheck="false"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <button type="button" class="secret-toggle" :title="visible ? t('common.hideTitle') : t('common.showTitle')" @click="toggle">
      <UiIcon :name="visible ? 'eye-off' : 'eye'" :size="15" />
    </button>
  </div>
</template>

<style scoped>
.secret-icon {
  margin-left: 11px;
  color: var(--text-faint);
}
.secret-toggle {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 0;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
}
.secret-toggle:hover {
  color: var(--text);
}
</style>

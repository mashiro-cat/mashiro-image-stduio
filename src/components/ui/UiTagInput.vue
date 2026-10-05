<script setup lang="ts">
import { ref } from "vue";
import { t } from "../../i18n";
import UiIcon from "./UiIcon.vue";

const props = withDefaults(
  defineProps<{
    modelValue: string[];
    placeholder?: string;
    /** 从已有标签中挑选 */
    suggestions?: string[];
  }>(),
  {
    // ⚠️ 默认值里不能直接 `t(...)`：withDefaults 的默认对象在组件初始化时求值一次，
    // 之后不再跟随语言变化。所以留空，在模板里用 `placeholder || t(...)` 兜底。
    placeholder: "",
    suggestions: () => [],
  },
);

const emit = defineEmits<{ "update:modelValue": [value: string[]] }>();

const input = ref("");

function addTag(raw: string) {
  const value = raw.trim();
  if (!value || props.modelValue.includes(value)) {
    input.value = "";
    return;
  }
  emit("update:modelValue", [...props.modelValue, value]);
  input.value = "";
}

function removeTag(tag: string) {
  emit(
    "update:modelValue",
    props.modelValue.filter((item) => item !== tag),
  );
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" || event.key === ",") {
    event.preventDefault();
    addTag(input.value);
  } else if (event.key === "Backspace" && !input.value && props.modelValue.length) {
    removeTag(props.modelValue[props.modelValue.length - 1]);
  }
}

const unused = () => props.suggestions.filter((item) => !props.modelValue.includes(item)).slice(0, 8);
</script>

<template>
  <div class="tag-input-wrap">
    <div class="tag-input">
      <span v-for="tag in modelValue" :key="tag" class="tag tag-accent">
        {{ tag }}
        <button type="button" class="tag-remove" @click="removeTag(tag)">
          <UiIcon name="close" :size="11" />
        </button>
      </span>
      <input
        v-model="input"
        class="tag-field"
        :placeholder="modelValue.length ? '' : placeholder || t('common.inputPlaceholder')"
        @keydown="onKeydown"
        @blur="addTag(input)"
      />
    </div>
    <div v-if="unused().length" class="tag-suggestions">
      <span class="t-xs t-3rd">{{ t("common.tipsLabel") }}</span>
      <button v-for="tag in unused()" :key="tag" type="button" class="tag tag-clickable" @click="addTag(tag)">
        {{ tag }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.tag-input-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tag-input {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 5px 9px;
  border: 1px solid var(--border-input);
  border-radius: var(--r-sm);
  background: var(--bg-surface);
  transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
}
.tag-input:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-ring);
}
.tag-field {
  flex: 1;
  min-width: 90px;
  border: 0;
  background: transparent;
  font-size: var(--fs-13);
  height: 22px;
}
.tag-field:focus {
  outline: none;
}
.tag-remove {
  display: grid;
  place-items: center;
  border: 0;
  padding: 0;
  background: transparent;
  color: inherit;
  opacity: 0.7;
  cursor: pointer;
}
.tag-remove:hover {
  opacity: 1;
}
.tag-suggestions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
</style>

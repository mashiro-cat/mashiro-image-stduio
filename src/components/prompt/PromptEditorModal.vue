<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { PromptItem } from "../../types";
import { PROMPT_CATEGORIES, usePromptStore } from "../../stores/prompts";
import { t } from "../../i18n";
import UiModal from "../ui/UiModal.vue";
import UiTagInput from "../ui/UiTagInput.vue";
import UiSwitch from "../ui/UiSwitch.vue";
import UiIcon from "../ui/UiIcon.vue";

const props = defineProps<{
  open: boolean;
  /** 为空表示新建 */
  item: PromptItem | null;
}>();

const emit = defineEmits<{ "update:open": [value: boolean]; saved: [item: PromptItem] }>();

const prompts = usePromptStore();

/**
 * 分类名是数据（要存进 PromptItem.category），展示时才按词条翻。
 * 下标与 PROMPT_CATEGORIES 一一对应，见 i18n/parts/prompts.ts 的 category 分组。
 */
const CATEGORY_KEYS = [
  "prompts.category.portrait",
  "prompts.category.scene",
  "prompts.category.product",
  "prompts.category.ecommerce",
  "prompts.category.advertising",
  "prompts.category.poster",
  "prompts.category.illustration",
  "prompts.category.character",
  "prompts.category.ui",
  "prompts.category.architecture",
  "prompts.category.concept",
  "prompts.category.community",
  "prompts.category.other",
];

const categoryOptions = computed(() =>
  PROMPT_CATEGORIES.map((name, index) => ({ value: name, label: t(CATEGORY_KEYS[index] ?? "") })),
);

/**
 * 默认分类。
 *
 * ⚠️ 这里是**数据**不是文案：`category` 会随 `PromptItem` 持久化，
 * 并且提示词库的「按分类筛选」是拿它做等值匹配的。
 * 一旦按界面语言翻译后写回，切语言就会让既有条目全部筛不出来。
 * 所以固定用中文原值，界面展示走 `categoryLabel()` 查表。
 */
const DEFAULT_CATEGORY = "其他";

const form = ref({
  title: "",
  content: "",
  negative: "",
  category: DEFAULT_CATEGORY,
  tags: [] as string[],
  favorite: false,
});

const isEdit = computed(() => Boolean(props.item));

watch(
  () => [props.open, props.item] as const,
  () => {
    if (!props.open) return;
    if (props.item) {
      form.value = {
        title: props.item.title,
        content: props.item.content,
        negative: props.item.negative,
        category: props.item.category,
        tags: [...props.item.tags],
        favorite: props.item.favorite,
      };
    } else {
      form.value = { title: "", content: "", negative: "", category: DEFAULT_CATEGORY, tags: [], favorite: false };
    }
  },
  { immediate: true },
);

function save() {
  if (!form.value.content.trim()) return;
  const payload = {
    title: form.value.title.trim() || form.value.content.slice(0, 18),
    content: form.value.content.trim(),
    negative: form.value.negative.trim(),
    category: form.value.category,
    tags: form.value.tags,
    favorite: form.value.favorite,
  };

  if (props.item) {
    prompts.update(props.item.id, payload);
    emit("saved", { ...props.item, ...payload });
  } else {
    const created = prompts.add(payload);
    emit("saved", created);
  }
  emit("update:open", false);
}
</script>

<template>
  <UiModal
    :open="open"
    :title="isEdit ? t('prompts.editor.editTitle') : t('prompts.editor.createTitle')"
    :description="t('prompts.editor.desc')"
    :width="620"
    @update:open="emit('update:open', $event)"
  >
    <div class="form">
      <label class="field">
        <span class="field-label">{{ t("prompts.editor.titleLabel") }}</span>
        <input v-model="form.title" class="input" :placeholder="t('prompts.editor.titlePlaceholder')" />
      </label>

      <div class="row gap-3">
        <label class="field grow">
          <span class="field-label">{{ t("prompts.editor.categoryLabel") }}</span>
          <select v-model="form.category" class="select">
            <option v-for="category in categoryOptions" :key="category.value" :value="category.value">
              {{ category.label }}
            </option>
          </select>
        </label>
        <div class="field grow">
          <span class="field-label">{{ t("prompts.editor.favoriteLabel") }}</span>
          <UiSwitch v-model="form.favorite" :label="t('prompts.editor.favoriteSwitch')" />
        </div>
      </div>

      <label class="field">
        <span class="field-label">
          {{ t("prompts.editor.positiveLabel") }}
          <span class="t-xs t-faint">{{ form.content.length }}/4000</span>
        </span>
        <textarea
          v-model="form.content"
          class="textarea"
          maxlength="4000"
          :placeholder="t('prompts.editor.positivePlaceholder')"
          style="min-height: 120px"
        />
      </label>

      <label class="field">
        <span class="field-label">
          {{ t("prompts.editor.negativeLabel")
          }}<span class="t-xs t-faint">{{ t("studio.prompt.negative.optional") }}</span>
        </span>
        <textarea
          v-model="form.negative"
          class="textarea"
          maxlength="2000"
          :placeholder="t('prompts.editor.negativePlaceholder')"
          style="min-height: 62px"
        />
      </label>

      <div class="field">
        <span class="field-label">{{ t("prompts.editor.tagsLabel") }}</span>
        <UiTagInput v-model="form.tags" :suggestions="prompts.allTags" />
      </div>
    </div>

    <template #footer>
      <button class="btn" @click="emit('update:open', false)">{{ t("common.cancel") }}</button>
      <button class="btn btn-primary" :disabled="!form.content.trim()" @click="save">
        <UiIcon name="check" :size="14" />{{ isEdit ? t("prompts.editor.save") : t("prompts.editor.create") }}
      </button>
    </template>
  </UiModal>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
</style>

<script setup lang="ts">
import UiIcon from "./UiIcon.vue";

withDefaults(
  defineProps<{
    icon?: string;
    title: string;
    description?: string;
    compact?: boolean;
  }>(),
  { icon: "image", description: "", compact: false },
);
</script>

<template>
  <div class="empty" :class="{ 'is-compact': compact }">
    <span class="empty-icon">
      <UiIcon :name="icon" :size="compact ? 20 : 24" />
    </span>
    <div>
      <p class="empty-title">{{ title }}</p>
      <p v-if="description" class="empty-desc">{{ description }}</p>
    </div>
    <div v-if="$slots.default" class="empty-actions">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.is-compact {
  padding: 24px 16px;
}
.empty-title {
  font-size: var(--fs-14);
  font-weight: 600;
  color: var(--text);
}
.empty-desc {
  margin-top: 4px;
  font-size: var(--fs-12);
  color: var(--text-tertiary);
  max-width: 340px;
}
.empty-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
</style>

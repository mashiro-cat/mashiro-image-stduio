<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { AUTO_SIZE, type ImageQuality } from "../../types";
import { ASPECT_OPTIONS, aspectOptions as aspectOptionsOfSettings, qualityOptions as qualityOptionsOfSettings, useSettingsStore } from "../../stores/settings";
import { usePresetsStore } from "../../stores/presets";
import { sizeLabel } from "../../platform/env";
import { t } from "../../i18n";
import UiIcon from "../ui/UiIcon.vue";
import UiNumber from "../ui/UiNumber.vue";
import UiSegmented from "../ui/UiSegmented.vue";

const props = withDefaults(
  defineProps<{
    model: string;
    size: string;
    count: number;
    quality: ImageQuality;
    style: string;
    seed: number | null;
    steps: number | null;
    disabled?: boolean;
    /** 是否展示与工作流相关的参数 */
    showWorkflowParams?: boolean;
  }>(),
  { disabled: false, showWorkflowParams: false },
);

const emit = defineEmits<{
  "update:model": [value: string];
  "update:size": [value: string];
  "update:count": [value: number];
  "update:quality": [value: ImageQuality];
  "update:style": [value: string];
  "update:seed": [value: number | null];
  "update:steps": [value: number | null];
}>();

const settings = useSettingsStore();
const presets = usePresetsStore();

const advancedOpen = ref(false);
const customSizeOpen = ref(false);
const customSize = ref("");

const STYLE_ICONS: Record<string, string> = {
  写实摄影: "eye",
  电影感: "maximize",
  动漫插画: "star",
  赛博朋克: "zap",
  水彩手绘: "palette",
  "3D 渲染": "cpu",
  极简产品: "crop",
  蒸汽波: "spark",
};

const models = computed(() => {
  // 没有可用渠道时（演示模式）回退到第一条渠道，保证模型列表依然可读可改
  const channel = settings.activeModelChannel ?? settings.state.modelApi.channels[0];
  if (!channel) return [];
  const list = channel.modelOptions.map((name) => name.trim()).filter(Boolean);
  // 当前模型必须出现在候选里，否则切换渠道后会出现「选中项不在列表里」
  if (channel.model && !list.includes(channel.model)) list.unshift(channel.model);
  return list;
});

/* 模型下拉：面板里只展示「当前模型」一行，完整列表收进弹层，
   避免模型多的时候把参数区撑得很长。 */
const pickerOpen = ref(false);
const pickerRef = ref<HTMLElement | null>(null);
const modelKeyword = ref("");

const visibleModels = computed(() => {
  const text = modelKeyword.value.trim().toLowerCase();
  if (!text) return models.value;
  return models.value.filter((name) => name.toLowerCase().includes(text));
});

function togglePicker() {
  if (props.disabled || !models.value.length) return;
  pickerOpen.value = !pickerOpen.value;
  if (!pickerOpen.value) return;
  modelKeyword.value = "";
  // 列表展开后把当前模型滚到可视区域，模型很多时不用自己找
  requestAnimationFrame(() => {
    pickerRef.value?.querySelector(".model-option.is-active")?.scrollIntoView({ block: "nearest" });
  });
}

function chooseModel(name: string) {
  emit("update:model", name);
  pickerOpen.value = false;
}

/* 参数预设已移除：模型基本固定时它只剩「省点几下点击」，
   而 size/count/quality 本来就由 draft 持久化、下次打开还在。
   现在只保留风格预设（改的是提示词内容，是真正的杠杆）。 */

function onDocumentPointerDown(event: PointerEvent) {
  const target = event.target as Node | null;
  if (pickerOpen.value) {
    const root = pickerRef.value;
    if (!root || !target || !root.contains(target)) pickerOpen.value = false;
  }
}

onMounted(() => document.addEventListener("pointerdown", onDocumentPointerDown, true));
onBeforeUnmount(() => document.removeEventListener("pointerdown", onDocumentPointerDown, true));

const styleList = computed(() =>
  presets.styles.map((item) => ({ label: item.label, value: item.value, icon: STYLE_ICONS[item.label] ?? "spark" })),
);

// 只按 size 查原始常量拿比例信息，不涉及文案，所以用未本地化的 ASPECT_OPTIONS
const activeAspect = computed(() => ASPECT_OPTIONS.find((item) => item.size === props.size));

function applyCustomSize() {
  const value = customSize.value.trim().replace(/[×*]/gi, "x");
  if (/^\d{3,5}x\d{3,5}$/i.test(value)) {
    emit("update:size", value.toLowerCase());
    customSizeOpen.value = false;
  }
}

function toggleStyle(label: string) {
  emit("update:style", props.style === label ? "" : label);
}

function setQuality(value: string) {
  emit("update:quality", value as ImageQuality);
}

function setSeed(value: string) {
  emit("update:seed", value === "" ? null : Number(value));
}

function setSteps(value: string) {
  emit("update:steps", value === "" ? null : Number(value));
}

function randomSeed() {
  emit("update:seed", Math.floor(Math.random() * 2 ** 31));
}

function ratioBoxStyle(ratio: string) {
  const [w, h] = ratio.split(":").map(Number);
  const max = 20;
  if (!w || !h) return { width: `${max}px`, height: `${max}px` };
  if (w >= h) return { width: `${max}px`, height: `${Math.round((max * h) / w)}px` };
  return { width: `${Math.round((max * w) / h)}px`, height: `${max}px` };
}

const isDemoModel = computed(() => settings.useDemo);

/** sizeLabel() 是界面文案函数，跟随当前语言；像素值原样透出 */
function sizeText(value: string) {
  return value === AUTO_SIZE ? t("studio.params.size.auto") : sizeLabel(value);
}

/**
 * 画幅与画质选项：枚举值（size / quality）是数据，label 与 hint 走词条查表。
 *
 * ⚠️ 这里直接复用 `stores/settings` 里的 `aspectOptions()` / `qualityOptions()`，
 * 不在本组件另建映射表——那份权威映射在 setting store 里加过 i18n 键，
 * 组件里再抄一份必然会漂移（改词条时只改到一半，另一半继续显示旧语言）。
 *
 * 纯比例写法（1:1、16:9…）本身就是记号，词条里保持原样不翻译。
 */
const aspectOptions = computed(() => aspectOptionsOfSettings());

const qualityOptions = computed(() => qualityOptionsOfSettings());
</script>

<template>
  <div class="params">
    <!-- 当前模型：面板里只保留一行，点开弹层再切换 -->
    <section class="block">
      <div class="row-between block-head">
        <span class="panel-title">{{ t("studio.params.model.title") }}</span>
        <span v-if="isDemoModel" class="tag tag-warning">{{ t("studio.params.model.demo") }}</span>
        <span v-else-if="models.length > 1" class="t-xs t-3rd">{{
          t("studio.params.model.optionCount", { count: models.length })
        }}</span>
      </div>

      <div ref="pickerRef" class="model-picker">
        <button
          class="model-trigger"
          :class="{ 'is-open': pickerOpen }"
          :disabled="disabled || !models.length"
          :title="model || t('studio.params.model.none')"
          @click="togglePicker"
        >
          <span class="model-icon">
            <UiIcon name="sparkles" :size="16" />
          </span>
          <span class="grow model-text">
            <span class="model-name t-ellipsis">{{ model || t("studio.params.model.none") }}</span>
            <span class="model-sub">
              {{ models.length > 1 ? t("studio.params.model.switch") : t("studio.params.model.protocol") }}
            </span>
          </span>
          <UiIcon :name="pickerOpen ? 'chevron-up' : 'chevron-down'" :size="15" class="t-3rd" />
        </button>

        <div v-if="pickerOpen" class="model-menu">
          <div v-if="models.length > 6" class="model-search">
            <UiIcon name="search" :size="14" />
            <input v-model="modelKeyword" class="model-search-input" :placeholder="t('studio.params.model.searchPlaceholder')" />
            <button v-if="modelKeyword" class="icon-btn" :title="t('common.reset')" @click="modelKeyword = ''">
              <UiIcon name="close" :size="13" />
            </button>
          </div>

          <div class="model-list">
            <button
              v-for="name in visibleModels"
              :key="name"
              class="model-option"
              :class="{ 'is-active': model === name }"
              @click="chooseModel(name)"
            >
              <span class="grow t-ellipsis">{{ name }}</span>
              <UiIcon v-if="model === name" name="check" :size="14" />
            </button>
            <p v-if="!visibleModels.length" class="model-empty">{{ t("studio.params.model.noMatch") }}</p>
          </div>

          <p class="model-foot">
            <UiIcon name="settings" :size="13" />
            <RouterLink :to="{ path: '/settings', query: { tab: 'model' } }" class="hint-link">
              {{ t("studio.params.model.settingsLink") }}
            </RouterLink>
            {{ t("studio.params.model.settingsFoot") }}
          </p>
        </div>
      </div>
    </section>

    <slot name="extra-top" />

    <!-- 风格预设 -->
    <section class="block">
      <div class="row-between block-head">
        <span class="panel-title">{{ t("studio.params.style.title") }}</span>
        <button v-if="style" class="link-btn" @click="emit('update:style', '')">
          {{ t("studio.params.style.clear") }}
        </button>
      </div>
      <div class="style-grid">
        <button
          v-for="item in styleList"
          :key="item.label"
          class="style-tile"
          :class="{ 'is-active': style === item.label }"
          :disabled="disabled"
          :title="item.value"
          @click="toggleStyle(item.label)"
        >
          <UiIcon :name="item.icon" :size="15" />
          <span>{{ item.label }}</span>
        </button>
      </div>
    </section>

    <!-- 图片比例 -->
    <section class="block">
      <div class="row-between block-head">
        <span class="panel-title">{{ t("studio.params.aspect.title") }}</span>
        <span class="t-xs t-3rd">{{ sizeText(size) }}</span>
      </div>
      <div class="ratio-grid">
        <button
          v-for="item in aspectOptions"
          :key="item.size"
          class="ratio-tile"
          :class="{ 'is-active': size === item.size }"
          :disabled="disabled"
          :title="item.hint"
          @click="emit('update:size', item.size)"
        >
          <UiIcon v-if="item.ratio === 'auto'" name="wand" :size="19" />
          <span v-else class="ratio-box" :style="ratioBoxStyle(item.ratio)" />
          <span class="ratio-label">{{ item.label }}</span>
        </button>
      </div>
      <p v-if="size === AUTO_SIZE" class="field-hint">
        {{ t("studio.params.size.autoUsedHint") }}
      </p>
      <div class="custom-row">
        <button class="link-btn" @click="customSizeOpen = !customSizeOpen">
          <UiIcon name="crop" :size="13" />{{ t("studio.params.size.custom") }}
        </button>
        <span v-if="!activeAspect" class="tag tag-accent">{{ sizeText(size) }}</span>
      </div>
      <div v-if="customSizeOpen" class="custom-input">
        <input
          v-model="customSize"
          class="input"
          :placeholder="t('studio.params.size.customPlaceholder')"
          @keydown.enter="applyCustomSize"
        />
        <button class="btn btn-sm" @click="applyCustomSize">{{ t("studio.action.apply") }}</button>
      </div>
    </section>

    <!-- 生成数量 -->
    <section class="block">
      <div class="row-between block-head">
        <span class="panel-title">{{ t("studio.params.count.title") }}</span>
        <span class="t-xs t-3rd">{{ t("studio.params.count.range") }}</span>
      </div>
      <UiNumber
        :model-value="count"
        :min="1"
        :max="10"
        :suffix="t('studio.params.count.suffix')"
        @update:model-value="emit('update:count', $event)"
      />
    </section>

    <!-- 高级设置 -->
    <section class="block">
      <button class="collapse-head" @click="advancedOpen = !advancedOpen">
        <span class="panel-title">{{ t("studio.params.advanced.title") }}</span>
        <UiIcon :name="advancedOpen ? 'chevron-up' : 'chevron-down'" :size="15" class="t-3rd" />
      </button>

      <div v-if="advancedOpen" class="advanced">
        <div class="field">
          <span class="field-label">{{ t("studio.params.quality.title") }}</span>
          <UiSegmented
            :model-value="quality"
            block
            :options="qualityOptions"
            @update:model-value="setQuality"
          />
        </div>

        <template v-if="showWorkflowParams">
          <div class="field">
            <span class="field-label">{{ t("studio.params.seed.label") }}</span>
            <div class="row gap-2">
              <input
                class="input"
                type="number"
                :placeholder="t('studio.params.seed.placeholder')"
                :value="seed ?? ''"
                @input="setSeed(($event.target as HTMLInputElement).value)"
              />
              <button class="btn btn-sm" :title="t('studio.params.seed.random')" @click="randomSeed">
                <UiIcon name="refresh" :size="13" />
              </button>
            </div>
          </div>
          <div class="field">
            <span class="field-label">{{ t("studio.params.steps.label") }}</span>
            <input
              class="input"
              type="number"
              :placeholder="t('studio.params.steps.placeholder')"
              :value="steps ?? ''"
              @input="setSteps(($event.target as HTMLInputElement).value)"
            />
          </div>
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
.params {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 18px;
}
.block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.block-head {
  gap: 8px;
}
.model-picker {
  position: relative;
}
.model-trigger {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-surface);
  text-align: left;
  cursor: pointer;
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.model-trigger:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: var(--bg-subtle);
}
.model-trigger.is-open {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.model-trigger:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}
.model-text {
  min-width: 0;
}
.model-icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: var(--r-sm);
  background: var(--brand-grad-soft);
  color: var(--accent-soft-fg);
}
.model-name {
  display: block;
  font-size: var(--fs-13);
  font-weight: 600;
}
.model-sub {
  display: block;
  font-size: var(--fs-11);
  color: var(--text-tertiary);
}

.model-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-surface);
  box-shadow: var(--shadow-lg);
}
.model-search {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: none;
  height: 32px;
  padding: 0 8px;
  margin-bottom: 6px;
  border: 1px solid var(--border-input);
  border-radius: var(--r-sm);
  background: var(--bg-subtle);
  color: var(--text-tertiary);
}
.model-search:focus-within {
  border-color: var(--accent);
  background: var(--bg-surface);
}
.model-search-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  font-size: var(--fs-12);
}
.model-search-input:focus {
  outline: none;
}
.model-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 210px;
  overflow-y: auto;
}
.model-option {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  width: 100%;
  padding: 7px 9px;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--fs-12);
  text-align: left;
  cursor: pointer;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.model-option:hover {
  background: var(--bg-subtle);
  color: var(--text);
}
.model-option.is-active {
  background: var(--accent-soft);
  color: var(--accent-soft-fg);
  font-weight: 600;
}
.model-empty {
  padding: 10px 4px;
  font-size: var(--fs-12);
  color: var(--text-tertiary);
  text-align: center;
}
.model-foot {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: none;
  margin-top: 6px;
  padding: 7px 2px 1px;
  border-top: 1px solid var(--border);
  font-size: var(--fs-11);
  color: var(--text-tertiary);
}
.hint-link {
  color: var(--accent);
}

.style-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 7px;
}
.style-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 56px;
  padding: 0 2px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--dur) var(--ease);
}
.style-tile:hover:not(:disabled) {
  border-color: var(--border-strong);
  color: var(--text);
  background: var(--bg-subtle);
}
.style-tile.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-soft-fg);
}

.ratio-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 7px;
}
.ratio-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 50px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-surface);
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all var(--dur) var(--ease);
}
.ratio-tile:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: var(--bg-subtle);
}
.ratio-tile.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-soft-fg);
}
.ratio-box {
  border: 1.5px solid currentColor;
  border-radius: 3px;
  opacity: 0.85;
}
.ratio-label {
  font-size: 10.5px;
  font-weight: 600;
}
.custom-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.custom-input {
  display: flex;
  gap: 8px;
}
.link-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--accent);
  font-size: var(--fs-12);
  font-weight: 550;
  cursor: pointer;
}
.link-btn:hover {
  text-decoration: underline;
}
.link-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  text-decoration: none;
}

.collapse-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}
.advanced {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-top: 4px;
}
</style>

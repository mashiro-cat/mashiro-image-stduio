<script setup lang="ts">
import { computed, ref } from "vue";
import type { StructuredPrompt, TaskStatus } from "../../types";
import { useSettingsStore } from "../../stores/settings";
import { t } from "../../i18n";
import UiIcon from "../ui/UiIcon.vue";
import EnhanceResult from "./EnhanceResult.vue";

const props = withDefaults(
  defineProps<{
    prompt: string;
    negative: string;
    structured: StructuredPrompt | null;
    styleLabel: string;
    status: TaskStatus;
    /** 生成按钮文案 */
    submitLabel?: string;
    /** 底部提示中「本次实际调用的目标」，例如渠道名 + 模型名 */
    runTarget?: string;
    /** 增强面板插槽内容由父级提供事件 */
    enhanceNotes?: string[];
    enhanceResultPrompt?: string;
    enhanceResultNegative?: string;
    /** 增强结果是否已被采纳 */
    enhanceApplied?: boolean;
    /** 增强前的提示词，用于前后对比 */
    enhanceOriginal?: string;
    /** 本次增强实际发送给模型的参考图数量 */
    enhanceImages?: number;
    /** 工作台当前的参考图数量（用于在请求发起前预告会带几张图） */
    referenceCount?: number;
    /** 增强结果里的结构化拆解 */
    enhanceStructured?: StructuredPrompt | null;
    /** 本次结果的来源：enhance 扩写 / reverse 反推（决定结果面板的呈现方式） */
    enhanceKind?: "enhance" | "reverse";
    /** 增强用的 LLM（渠道名 + 模型名），为空表示走演示增强 */
    llmLabel?: string;
    /** 是否正在请求中 */
    enhancing?: boolean;
    /** 是否具备多模态能力（决定是否提示会传图） */
    visionEnabled?: boolean;
  }>(),
  {
    runTarget: "",
    enhanceNotes: () => [],
    enhanceResultPrompt: "",
    enhanceResultNegative: "",
    enhanceApplied: false,
    enhanceOriginal: "",
    enhanceImages: 0,
    referenceCount: 0,
    enhanceStructured: null,
    enhanceKind: "enhance",
    llmLabel: "",
    enhancing: false,
    visionEnabled: false,
  },
);

const emit = defineEmits<{
  "update:prompt": [value: string];
  "update:negative": [value: string];
  "update:structured": [value: StructuredPrompt];
  "update:styleLabel": [value: string];
  submit: [];
  cancel: [];
  enhance: [];
  reverse: [];
  applyEnhance: [];
  discardEnhance: [];
  saveToLibrary: [];
  replacePrompt: [value: string];
}>();

const settings = useSettingsStore();
const tab = ref<"prompt" | "enhance">("prompt");

const PROMPT_MAX = 4000;
const NEGATIVE_MAX = 2000;

const busy = computed(() => props.status === "running" || props.status === "queued");
const canEnhance = computed(() => settings.hasLlm || settings.useDemo);

/** 父级没给按钮文案时回退到默认的「生成图片」 */
const submitLabel = computed(() => props.submitLabel || t("studio.action.generate"));

/** 底部一行：演示模式优先级最高，否则展示父级给出的调用目标（渠道 / 模型） */
const footHint = computed(() => {
  if (settings.useDemo) return t("studio.action.footDemo");
  if (props.runTarget) return t("studio.action.footRunTarget", { target: props.runTarget });
  if (settings.activeModelChannel) {
    const target = `${settings.activeModelChannel.name} · ${
      settings.activeModelChannel.model || t("studio.channel.modelUnset")
    }`;
    return t("studio.action.footRunTarget", { target });
  }
  return t("studio.action.footNoChannel");
});

/** 结构化拆解的槽位名与输入提示是文案，槽位 key 本身才是数据，所以整个数组做成 computed */
const FIELDS = computed<
  Array<{ key: keyof StructuredPrompt; label: string; icon: string; placeholder: string }>
>(() => [
  { key: "subject", label: t("studio.prompt.field.subject"), icon: "star", placeholder: t("studio.prompt.field.subjectPlaceholder") },
  { key: "scene", label: t("studio.prompt.field.scene"), icon: "image", placeholder: t("studio.prompt.field.scenePlaceholder") },
  { key: "style", label: t("studio.prompt.field.style"), icon: "palette", placeholder: t("studio.prompt.field.stylePlaceholder") },
  { key: "lens", label: t("studio.prompt.field.lens"), icon: "crop", placeholder: t("studio.prompt.field.lensPlaceholder") },
  { key: "lighting", label: t("studio.prompt.field.lighting"), icon: "sun", placeholder: t("studio.prompt.field.lightingPlaceholder") },
  { key: "color", label: t("studio.prompt.field.color"), icon: "spark", placeholder: t("studio.prompt.field.colorPlaceholder") },
]);

const structuredDraft = computed<StructuredPrompt>(() => ({
  subject: props.structured?.subject ?? "",
  scene: props.structured?.scene ?? "",
  style: props.structured?.style ?? "",
  lens: props.structured?.lens ?? "",
  lighting: props.structured?.lighting ?? "",
  color: props.structured?.color ?? "",
  negative: props.structured?.negative ?? "",
}));

const structuredFilled = computed(() => FIELDS.value.filter((field) => structuredDraft.value[field.key]).length);

/** 增强页顶部：这次到底会调用谁、会不会带图 */
const enhanceTarget = computed(() => {
  if (settings.useDemo || !props.llmLabel) return t("studio.enhance.demoTarget");
  return props.llmLabel;
});

function patchStructured(key: keyof StructuredPrompt, value: string) {
  emit("update:structured", { ...structuredDraft.value, [key]: value });
}

function clearStructured() {
  emit("update:structured", { subject: "", scene: "", style: "", lens: "", lighting: "", color: "", negative: "" });
}

/** 把结构化字段拼成一段提示词 */
function composeFromStructured() {
  const parts = FIELDS.value.map((field) => structuredDraft.value[field.key]).filter(Boolean);
  if (!parts.length) return;
  emit("replacePrompt", parts.join(", "));
}
</script>

<template>
  <div class="panel card">
    <div class="panel-tabs">
      <button class="ptab" :class="{ 'is-active': tab === 'prompt' }" @click="tab = 'prompt'">
        <UiIcon name="type" :size="14" />{{ t("studio.prompt.tab") }}
      </button>
      <button class="ptab" :class="{ 'is-active': tab === 'enhance' }" @click="tab = 'enhance'">
        <UiIcon name="sparkles" :size="14" />{{ t("studio.prompt.tabEnhance") }}
      </button>
    </div>

    <div class="panel-body scroll-y">
      <!-- 提示词 -->
      <template v-if="tab === 'prompt'">
        <section class="sec">
          <div class="row-between">
            <span class="panel-title">{{ t("studio.prompt.positive") }}</span>
            <span class="row gap-1">
              <button
                class="icon-btn"
                :title="t('studio.prompt.saveToLibrary')"
                :disabled="!prompt"
                @click="emit('saveToLibrary')"
              >
                <UiIcon name="bookmark" :size="15" />
              </button>
              <button class="icon-btn" :title="t('studio.prompt.clear')" :disabled="!prompt" @click="emit('update:prompt', '')">
                <UiIcon name="trash" :size="15" />
              </button>
            </span>
          </div>
          <textarea
            class="textarea prompt-area"
            :maxlength="PROMPT_MAX"
            :placeholder="t('studio.prompt.positivePlaceholder')"
            :value="prompt"
            @input="emit('update:prompt', ($event.target as HTMLTextAreaElement).value)"
          />
          <div class="row-between">
            <span v-if="styleLabel" class="style-chip">
              <UiIcon name="palette" :size="12" />{{ styleLabel }}
              <button class="style-chip-x" :title="t('studio.prompt.removeStyle')" @click="emit('update:styleLabel', '')">
                <UiIcon name="close" :size="10" />
              </button>
            </span>
            <span v-else class="t-xs t-faint">{{ t("studio.prompt.noStyle") }}</span>
            <span class="t-xs t-faint">{{ prompt.length }}/{{ PROMPT_MAX }}</span>
          </div>
        </section>

        <button class="enhance-row" @click="tab = 'enhance'">
          <span class="enhance-icon"><UiIcon name="sparkles" :size="15" /></span>
          <span class="grow" style="min-width: 0">
            <span class="enhance-title">{{ t("studio.enhance.entryTitle") }}</span>
            <span class="enhance-sub">
              {{ canEnhance ? t("studio.enhance.entrySub") : t("studio.enhance.entrySubNoLlm") }}
            </span>
          </span>
          <span class="tag tag-brand">{{ t("studio.enhance.recommended") }}</span>
          <UiIcon name="chevron-right" :size="15" class="t-faint" />
        </button>

        <section class="sec">
          <div class="row-between">
            <span class="panel-title">
              {{ t("studio.prompt.structured.title") }}
              <span v-if="structuredFilled" class="t-xs t-3rd" style="font-weight: 400">
                · {{ t("studio.prompt.structured.filled", { filled: structuredFilled }) }}
              </span>
            </span>
            <span class="row gap-1">
              <button class="link-btn" :disabled="!structuredFilled" @click="composeFromStructured">
                {{ t("studio.prompt.structured.compose") }}
              </button>
              <button class="link-btn" :disabled="!structuredFilled" @click="clearStructured">
                {{ t("studio.prompt.structured.clear") }}
              </button>
            </span>
          </div>
          <p class="field-hint">{{ t("studio.prompt.structured.hint") }}</p>

          <div class="struct-list">
            <label v-for="field in FIELDS" :key="field.key" class="struct-row">
              <span class="struct-icon"><UiIcon :name="field.icon" :size="14" /></span>
              <span class="struct-label">{{ field.label }}</span>
              <input
                class="struct-input"
                :placeholder="field.placeholder"
                :value="structuredDraft[field.key]"
                @input="patchStructured(field.key, ($event.target as HTMLInputElement).value)"
              />
            </label>
          </div>
        </section>

        <section class="sec">
          <div class="row-between">
            <span class="panel-title">
              {{ t("studio.prompt.negative.title")
              }}<span class="t-xs t-3rd">{{ t("studio.prompt.negative.optional") }}</span>
            </span>
            <span class="t-xs t-faint">{{ negative.length }}/{{ NEGATIVE_MAX }}</span>
          </div>
          <textarea
            class="textarea negative-area"
            :maxlength="NEGATIVE_MAX"
            :placeholder="t('studio.prompt.negative.placeholder')"
            :value="negative"
            @input="emit('update:negative', ($event.target as HTMLTextAreaElement).value)"
          />
        </section>
      </template>

      <!-- 增强 -->
      <template v-else-if="tab === 'enhance'">
        <section class="sec">
          <div class="row-between">
            <span class="panel-title">{{ t("studio.enhance.panelTitle") }}</span>
            <span class="tag" :class="canEnhance ? 'tag-success' : 'tag-warning'">
              {{
                canEnhance
                  ? settings.hasLlm
                    ? t("studio.enhance.ready")
                    : t("studio.enhance.demoBadge")
                  : t("studio.enhance.notConfigured")
              }}
            </span>
          </div>
          <p class="field-hint">{{ t("studio.enhance.desc") }}</p>

          <div class="meta-box">
            <div class="meta-row">
              <span class="meta-label">{{ t("studio.enhance.metaModel") }}</span>
              <span class="meta-value t-ellipsis">{{ enhanceTarget }}</span>
            </div>
            <div class="meta-row">
              <span class="meta-label">{{ t("studio.enhance.metaReferences") }}</span>
              <span class="meta-value">
                <template v-if="!settings.hasLlm">{{ t("studio.enhance.refNoneDemo") }}</template>
                <template v-else-if="!visionEnabled">{{ t("studio.enhance.refDisabled") }}</template>
                <template v-else-if="enhanceImages">
                  {{ t("studio.enhance.refAttached", { count: enhanceImages }) }}
                </template>
                <template v-else-if="referenceCount">
                  {{ t("studio.enhance.refPlanned", { count: referenceCount }) }}
                </template>
                <template v-else>{{ t("studio.enhance.refNone") }}</template>
              </span>
            </div>
          </div>

          <!-- 反推不依赖当前提示词，所以这一块在反推模式下隐藏 -->
          <div v-if="enhanceKind !== 'reverse'" class="enhance-preview">
            <span class="preview-label">{{ t("studio.enhance.currentInput") }}</span>
            <p class="preview-text">{{ prompt || t("studio.enhance.currentInputEmpty") }}</p>
          </div>

          <button
            class="btn btn-brand btn-block btn-lg"
            :disabled="!prompt || !canEnhance || enhancing"
            @click="emit('enhance')"
          >
            <UiIcon
              :name="enhancing && enhanceKind === 'enhance' ? 'loader' : 'sparkles'"
              :size="16"
              :class="{ spin: enhancing && enhanceKind === 'enhance' }"
            />
            {{
              enhancing && enhanceKind === "enhance"
                ? t("studio.enhance.running")
                : enhanceResultPrompt
                  ? t("studio.enhance.rerun")
                  : t("studio.enhance.run")
            }}
          </button>

          <div class="alt-row">
            <span class="alt-line" />
            <span class="alt-text">{{ t("studio.enhance.or") }}</span>
            <span class="alt-line" />
          </div>

          <button
            class="btn btn-block"
            :disabled="!canEnhance || enhancing || !referenceCount"
            :title="referenceCount ? t('studio.reverse.title') : t('studio.reverse.needReference')"
            @click="emit('reverse')"
          >
            <UiIcon
              :name="enhancing && enhanceKind === 'reverse' ? 'loader' : 'wand'"
              :size="15"
              :class="{ spin: enhancing && enhanceKind === 'reverse' }"
            />
            {{ enhancing && enhanceKind === "reverse" ? t("studio.reverse.running") : t("studio.reverse.run") }}
          </button>
          <p class="field-hint">
            <template v-if="!referenceCount">
              {{ t("studio.reverse.hintEmpty") }}
            </template>
            <template v-else>
              {{ t("studio.reverse.hintWith", { count: referenceCount }) }}
            </template>
          </p>

          <p v-if="!canEnhance" class="field-hint">
            {{ t("studio.enhance.needSettingsPrefix")
            }}<RouterLink to="/settings" class="hint-link">{{ t("studio.enhance.needSettingsLink") }}</RouterLink
            >{{ t("studio.enhance.needSettingsSuffix") }}
          </p>
        </section>

        <section v-if="enhanceResultPrompt" class="sec">
          <EnhanceResult
            :prompt="enhanceResultPrompt"
            :variant="enhanceKind"
            :original="enhanceOriginal"
            :negative="enhanceResultNegative"
            :structured="enhanceStructured"
            :notes="enhanceNotes"
            :applied="enhanceApplied"
            sticky-actions
            @apply="emit('applyEnhance')"
            @discard="emit('discardEnhance')"
          />
        </section>
      </template>
    </div>

    <footer class="panel-foot">
      <button v-if="busy" class="btn btn-lg btn-block" @click="emit('cancel')">
        <UiIcon name="stop" :size="15" />{{ t("studio.action.cancel") }}
      </button>
      <button v-else class="btn btn-brand btn-lg btn-block" :disabled="!prompt" @click="emit('submit')">
        <UiIcon name="sparkles" :size="16" />{{ submitLabel }}
      </button>
      <p class="foot-hint">{{ footHint }}</p>
    </footer>
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.panel-tabs {
  display: flex;
  gap: 2px;
  padding: 10px 12px 0;
  border-bottom: 1px solid var(--border);
}
.ptab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 11px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--text-tertiary);
  font-size: var(--fs-13);
  font-weight: 500;
  cursor: pointer;
  transition: color var(--dur) var(--ease), border-color var(--dur) var(--ease);
}
.ptab:hover {
  color: var(--text);
}
.ptab.is-active {
  color: var(--accent);
  border-bottom-color: var(--accent);
  font-weight: 600;
}

.panel-body {
  flex: 1;
  min-height: 0;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.sec {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.prompt-area {
  min-height: 132px;
}
.negative-area {
  min-height: 62px;
}
.style-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 7px 3px 9px;
  border-radius: var(--r-full);
  background: var(--accent-soft);
  color: var(--accent-soft-fg);
  font-size: var(--fs-11);
  font-weight: 550;
}
.style-chip-x {
  display: grid;
  place-items: center;
  border: 0;
  padding: 0;
  background: transparent;
  color: inherit;
  opacity: 0.7;
  cursor: pointer;
}
.style-chip-x:hover {
  opacity: 1;
}

.enhance-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-subtle);
  text-align: left;
  cursor: pointer;
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.enhance-row:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.enhance-icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  flex: none;
  border-radius: var(--r-sm);
  background: var(--brand-grad);
  color: #fff;
}
.enhance-title {
  display: block;
  font-size: var(--fs-13);
  font-weight: 600;
}
.enhance-sub {
  display: block;
  font-size: var(--fs-11);
  color: var(--text-tertiary);
}

.struct-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.struct-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 9px;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bg-subtle);
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.struct-row:focus-within {
  border-color: var(--accent);
  background: var(--bg-surface);
}
.struct-icon {
  display: grid;
  place-items: center;
  color: var(--text-faint);
  flex: none;
}
.struct-label {
  flex: none;
  width: 30px;
  font-size: var(--fs-12);
  color: var(--text-tertiary);
}
.struct-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  font-size: var(--fs-12);
  color: var(--text);
}
.struct-input:focus {
  outline: none;
}

.preview-label {
  display: block;
  margin-bottom: 4px;
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-faint);
}
/* 调用目标信息 */
.meta-box {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 9px 11px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-muted);
}
.meta-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  font-size: var(--fs-11);
}
.meta-label {
  flex: none;
  width: 52px;
  color: var(--text-faint);
}
.meta-value {
  flex: 1;
  min-width: 0;
  color: var(--text-secondary);
}

/* 「增强」与「反推」两个入口之间的分隔线 */
.alt-row {
  display: flex;
  align-items: center;
  gap: 9px;
}
.alt-line {
  flex: 1;
  height: 1px;
  background: var(--border);
}
.alt-text {
  flex: none;
  font-size: var(--fs-11);
  color: var(--text-faint);
}

/* 「当前输入」预览；增强结果的展示见 EnhanceResult.vue */
.enhance-preview {
  padding: 10px 12px;
  border-radius: var(--r-md);
  background: var(--bg-muted);
  font-size: var(--fs-12);
  line-height: 1.6;
}
.preview-text {
  color: var(--text-tertiary);
  word-break: break-word;
}

.panel-foot {
  padding: 14px 16px 16px;
  border-top: 1px solid var(--border);
  background: var(--bg-subtle);
}
.foot-hint {
  margin-top: 8px;
  text-align: center;
  font-size: var(--fs-11);
  color: var(--text-faint);
}
.hint-link {
  color: var(--accent);
}
</style>

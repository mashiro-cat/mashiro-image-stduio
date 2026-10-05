import { computed, ref } from "vue";
import { zhCN, enUS } from "./locales";
import { NODE_ROLE_LABEL_KEYS, type WorkflowNodeRole } from "../types";

/** 支持的语言 */
export const LOCALES = ["zh-CN", "en-US"] as const;
export type Locale = (typeof LOCALES)[number];

/** 用户的语言偏好：跟随系统，或锁定某一种 */
export type LocalePreference = Locale | "system";

/** 缺词条时回退的语言 */
export const FALLBACK_LOCALE: Locale = "zh-CN";

const DICTIONARIES: Record<Locale, Record<string, string>> = {
  "zh-CN": zhCN,
  "en-US": enUS,
};

/* ------------------------------------------------------------ 系统语言检测 */

/**
 * 猜测系统语言。
 *
 * 桌面端跑在 WebView2 里，`navigator.language` 直接反映 Windows 的显示语言，
 * 不需要为了取语言去 Rust 侧加命令。取不到（老 WebView / SSR）时回退中文。
 *
 * 只看语言主段：`en-US` / `en-GB` / `en` 都算英文，`zh-TW` / `zh-CN` 都算中文。
 * 繁体目前没有独立词条，落中文是安全的一侧。
 */
export function detectSystemLocale(): Locale {
  const candidates: string[] = [];
  if (typeof navigator !== "undefined") {
    if (Array.isArray(navigator.languages)) candidates.push(...navigator.languages);
    if (navigator.language) candidates.push(navigator.language);
  }
  for (const raw of candidates) {
    const tag = String(raw || "").toLowerCase();
    if (!tag) continue;
    if (tag.startsWith("zh")) return "zh-CN";
    if (tag.startsWith("en")) return "en-US";
  }
  return FALLBACK_LOCALE;
}

/** 偏好 → 实际生效语言 */
export function resolveLocale(preference: LocalePreference): Locale {
  if (preference === "system") return detectSystemLocale();
  return LOCALES.includes(preference) ? preference : FALLBACK_LOCALE;
}

/* ------------------------------------------------------------ 运行时状态 */

const preference = ref<LocalePreference>("system");
const current = ref<Locale>(resolveLocale(preference.value));

/** 当前生效语言（响应式，切换后所有调用 `t()` 的地方自动重渲染） */
export const locale = computed(() => current.value);
/** 用户的原始偏好（可能是 system） */
export const localePreference = computed(() => preference.value);

/**
 * 把语言同步到 `<html lang>`。
 *
 * 除了无障碍（读屏软件按 lang 选发音规则），也让 CSS 能用 `:lang()` 写差异样式——
 * 英文长单词容易撑破紧凑布局，必要时可以按语言收一收。
 */
function syncDocumentLang() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = current.value;
}

/** 应用当前偏好到运行时（设置加载完成后调用，启动时必须走一次） */
export function applyLocalePreference() {
  const next = resolveLocale(preference.value);
  if (next !== current.value) current.value = next;
  syncDocumentLang();
}

/** 设置语言偏好并立即生效 */
export function setLocalePreference(next: LocalePreference) {
  preference.value = next;
  applyLocalePreference();
}

/* ------------------------------------------------------------ 翻译函数 */

export type TranslateParams = Record<string, string | number>;
/** 翻译函数的参数可以是任意键（拼接出来的动态键也算），字面量仍能拿到补全 */
export type MessageKey = keyof typeof zhCN | (string & {});

function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

/**
 * 取一条文案。
 *
 * 找不到时按「当前语言 → 中文 → 键名」三级回落：键名直接显示出来，
 * 比默默显示空字符串更容易在验收时被发现。
 *
 * 参数写法：`t("studio.params.model.optionCount", { count: 3 })`，词条里用 `{count}` 占位。
 * （示例里刻意用一个**真实存在**的键，别写成不存在的键，否则全项目扫键时会误报。）
 */
export function t(key: MessageKey, params?: TranslateParams): string {
  const table = DICTIONARIES[current.value];
  const hit = table[key] ?? DICTIONARIES[FALLBACK_LOCALE][key];
  return interpolate(hit ?? String(key), params);
}

/**
 * 翻译一段「可能已经被翻译过」的文本：原文是词条键就查表，不是就原样返回。
 *
 * 用于存进用户数据、之后又要展示的字段（例如渠道名称默认叫「生图渠道」，
 * 用户没改名时按当前语言显示，翻译成英文后不必去改磁盘上的数据）。
 */
export function tMaybe(text: string, params?: TranslateParams): string {
  if (!text) return text;
  if (DICTIONARIES[current.value][text] === undefined && DICTIONARIES[FALLBACK_LOCALE][text] === undefined) {
    return text;
  }
  return t(text, params);
}

/**
 * 设置页里展示的语言选项。
 *
 * ⚠️ **刻意做成函数而不是常量数组**：模块级常量在 import 时就求值一次，
 * 那一刻 `t()` 拿到的还是启动时的语言——用户切到英文后设置页仍显示「跟随系统」。
 * 词条必须在**渲染期**取，所以每次调用重新拼。
 *
 * 「简体中文 / English」两种写法保持语言自己的名字不翻译：
 * 用户认的是「这门语言叫什么」，译成英文反而认不出来。
 */
export function localeOptions(): Array<{ value: LocalePreference; label: string }> {
  return [
    { value: "system", label: t("settings.locale.system") },
    { value: "zh-CN", label: "简体中文" },
    { value: "en-US", label: "English" },
  ];
}

/**
 * 工作流输入角色的展示名。
 *
 * 为什么单独一个函数：`NODE_ROLE_META[role].label` 是**要存进用户配置的数据**
 * （会拼成「输入图片 2」再持久化），不能被翻译改写；
 * 而界面上要按当前语言显示，所以渲染期必须过一层查表。
 */
export function nodeRoleLabel(role: WorkflowNodeRole): string {
  return t(NODE_ROLE_LABEL_KEYS[role]);
}

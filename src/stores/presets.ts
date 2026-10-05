/* ==========================================================================
   风格预设中心
   ---------------------------------------------------------------------------
   风格预设：给正向提示词追加一段风格后缀（可另带配套负向词）。
   是「可编辑的持久化数据」而不是硬编码常量。

   内置的风格来自 `promptEnhance.STYLE_PRESETS`，只作为首次启动的种子：
   用户在设置页增删改之后，以本地这份为准。

   **这里曾有第二类「参数预设」（模型 / 尺寸 / 数量 / 画质），已整块移除。**
   移除理由：模型基本固定时它只剩「省点几下点击」，而这几个参数本来就由
   `stores/draft` 持久化（下次打开工作台还是上次的值），功能价值不足以
   占一块界面。老配置里的 `generations` 字段读取时直接忽略。
   ========================================================================== */

import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import { readJson, writeJson } from "../platform/storage";
import { uid } from "../platform/env";
import { STYLE_PRESETS } from "../services/promptEnhance";

/** 风格预设：label 是工作台里显示的短名，value 是追加到提示词末尾的英文片段 */
export interface StylePreset {
  id: string;
  label: string;
  value: string;
  /** 配套的负向词（可选），采纳该风格时一并追加到负向提示词 */
  negative: string;
  /** 内置风格：可改可删，但「恢复内置」会按 label 把它们补回来 */
  builtin: boolean;
}

interface PresetsFile {
  styles?: StylePreset[];
}

/** 内置风格种子；标签重复时以先出现的为准 */
function seedStyles(): StylePreset[] {
  return STYLE_PRESETS.map((item) => ({
    id: `sty_${item.label}`,
    label: item.label,
    value: item.value,
    negative: "",
    builtin: true,
  }));
}

const labelOf = (value: unknown) => (typeof value === "string" ? value.trim() : "");

function normalizeStyle(raw: Partial<StylePreset>): StylePreset | null {
  const label = labelOf(raw.label);
  if (!label) return null;
  return {
    id: labelOf(raw.id) || uid("sty"),
    label,
    value: labelOf(raw.value),
    negative: labelOf(raw.negative),
    builtin: Boolean(raw.builtin),
  };
}

export const usePresetsStore = defineStore("presets", () => {
  const styles = ref<StylePreset[]>([]);
  const loaded = ref(false);

  async function load() {
    const saved = await readJson<PresetsFile>("presets", {});

    // 风格：有记录就尊重用户的增删改；没有（首次启动 / 老版本升级）才播种子
    const savedStyles = Array.isArray(saved?.styles)
      ? saved.styles.map(normalizeStyle).filter((item): item is StylePreset => Boolean(item))
      : [];
    styles.value = savedStyles.length || Array.isArray(saved?.styles) ? savedStyles : seedStyles();

    loaded.value = true;
  }

  let timer: number | undefined;
  watch(
    styles,
    () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(
        () => void writeJson("presets", JSON.parse(JSON.stringify({ styles: styles.value }))),
        300,
      );
    },
    { deep: true },
  );

  /* ------------------------------------------------------------ 风格 */

  const styleLabels = computed(() => styles.value.map((item) => item.label));
  const hasStyle = (label: string) => styles.value.some((item) => item.label === label);

  /** 按 label 取风格；也接受直接传风格片段本身（MCP 侧允许两种写法），找不到返回 undefined */
  function findStyle(label: string): StylePreset | undefined {
    const key = labelOf(label);
    if (!key) return undefined;
    return styles.value.find((item) => item.label === key || (item.value && item.value === key));
  }

  /** 追加到正向提示词末尾的风格片段；label 不存在时返回空串 */
  function styleSuffix(label: string): string {
    return findStyle(label)?.value ?? "";
  }

  /** 该风格配套的负向词；没有则返回空串 */
  function styleNegative(label: string): string {
    return findStyle(label)?.negative ?? "";
  }

  function addStyle(patch: Partial<StylePreset> = {}): StylePreset {
    const item: StylePreset = {
      id: uid("sty"),
      label: patch.label?.trim() || "新风格",
      value: patch.value?.trim() ?? "",
      negative: patch.negative?.trim() ?? "",
      builtin: false,
    };
    // 同名风格会让 label 失去唯一性（工作台按 label 回查），直接拒绝重名
    if (hasStyle(item.label)) item.label = `${item.label} 2`;
    styles.value.push(item);
    return item;
  }

  function updateStyle(id: string, patch: Partial<StylePreset>) {
    const target = styles.value.find((item) => item.id === id);
    if (!target) return;
    const nextLabel = patch.label === undefined ? target.label : labelOf(patch.label) || target.label;
    if (nextLabel !== target.label && hasStyle(nextLabel)) {
      patch = { ...patch, label: target.label };
    }
    Object.assign(target, patch);
  }

  /** 删除风格 */
  function removeStyle(id: string) {
    styles.value = styles.value.filter((item) => item.id !== id);
  }

  /** 把缺失的内置风格按 label 补回来（不覆盖用户改过的同名风格） */
  function restoreDefaultStyles(): number {
    let added = 0;
    for (const seed of seedStyles()) {
      if (hasStyle(seed.label)) continue;
      styles.value.push({ ...seed, id: uid("sty") });
      added += 1;
    }
    return added;
  }

  /* ------------------------------------------------------------ 其他 */

  /** 恢复出厂：风格回到内置种子（「清空全部数据」时调用） */
  function resetToDefault() {
    styles.value = seedStyles();
  }

  return {
    styles,
    loaded,
    styleLabels,
    findStyle,
    hasStyle,
    styleSuffix,
    styleNegative,
    addStyle,
    updateStyle,
    removeStyle,
    restoreDefaultStyles,
    resetToDefault,
    load,
  };
});

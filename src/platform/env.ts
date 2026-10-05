/* ==========================================================================
   运行时环境判定：Tauri 桌面端 / 浏览器预览
   桌面端所有出网请求与文件读写都走 Rust 侧，浏览器预览时降级为 Web API。
   ========================================================================== */

import { AUTO_SIZE } from "../types";
import { t } from "../i18n";

export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Tauri 原生 invoke，浏览器预览时抛错由调用方兜底 */
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const mod = await import("@tauri-apps/api/core");
  return mod.invoke<T>(cmd, args);
}

/**
 * 把本地绝对路径转换为 webview 可访问的 URL。
 *
 * 结果按路径缓存：`convertFileSrc` 是纯函数，同一路径永远得到同一 URL，
 * 而调用点极多（历史记录几十张卡 + 详情 + 首页 gallery + 工作台缩略图条…），
 * 每处都 `await import()` 一遍纯属浪费。缓存后这些调用退化成 Map 命中。
 */
const fileUrlCache = new Map<string, string | null>();

export async function fileUrl(path: string): Promise<string | null> {
  if (!isTauri() || !path) return null;
  if (fileUrlCache.has(path)) return fileUrlCache.get(path) ?? null;
  let url: string | null = null;
  try {
    const mod = await import("@tauri-apps/api/core");
    url = mod.convertFileSrc(path);
  } catch {
    url = null;
  }
  fileUrlCache.set(path, url);
  return url;
}

/** 生成唯一 ID（无第三方依赖） */
export function uid(prefix = "id"): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

/** 毫秒时间戳 → 本地化文本 */
export function formatTime(ts: number, withTime = true): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return withTime ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
}

/**
 * 相对时间。词条在 `media.time.*`，超过 30 天回落到绝对日期（两种语言同构，不出词条）。
 *
 * 这三个函数都在渲染路径上被调用，`t()` 读的是响应式语言，
 * 所以切语言后不需要重新计算缓存，下一次渲染自然就换了语言。
 */
export function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return t("media.time.justNow");
  if (min < 60) return t("media.time.minutesAgo", { n: min });
  const hour = Math.floor(min / 60);
  if (hour < 24) return t("media.time.hoursAgo", { n: hour });
  const day = Math.floor(hour / 24);
  if (day < 30) return t("media.time.daysAgo", { n: day });
  return formatTime(ts, false);
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

export function formatDuration(ms?: number): string {
  if (!ms || ms < 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return t("media.duration.minSec", { m, s });
}

/** 尺寸展示文案：自动 / 未指定都显示为「自动」，其余原样（1024×1024 这类原样透传） */
export function sizeLabel(size?: string): string {
  return !size || size === AUTO_SIZE ? t("media.size.auto") : size;
}

/**
 * 尺寸的**中文**标签，供拼进 LLM 提示词 / MCP 技术描述时使用。
 *
 * ⚠️ 为什么不能直接用 `sizeLabel()`：那是个界面文案函数，跟随当前语言。
 * 而 `services/promptEnhance.ts` 把它拼进
 * `【尺寸】${sizeLabel(size)}` 这样的**中文系统提示词**里——
 * 英文界面下会变成 `【尺寸】Auto`，中英混杂进给模型的上下文。
 * `services/mcpBridge.ts` 同理：那段是给外部 Agent 读的技术摘要。
 *
 * 这两处要的是「稳定的中文技术描述」，不是界面文案，所以走这个函数。
 */
export function sizeLabelZh(size?: string): string {
  return !size || size === AUTO_SIZE ? "自动" : size;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 复制文本到剪贴板 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** 在系统浏览器中打开外部链接（桌面端走 opener 插件，浏览器预览走新标签页） */
export async function openExternal(url: string): Promise<boolean> {
  if (!/^https?:\/\//i.test(url)) return false;
  if (isTauri()) {
    try {
      const mod = await import("@tauri-apps/plugin-opener");
      await mod.openUrl(url);
      return true;
    } catch {
      return false;
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}

/* ==========================================================================
   窗口控制：自定义标题栏需要的最小化 / 最大化 / 关闭能力。
   只在 Tauri 桌面端生效，浏览器预览模式下全部降级为空操作（不报错）。
   这一层是唯一的窗口 API 出口 —— 后续若要换成 tauri-plugin-decoration
   之类的插件，只需替换本文件，UI 不用改。
   ========================================================================== */

import { isTauri } from "./env";

/**
 * 是否 macOS：macOS 走「保留原生红绿灯」路线（decorations 打开 + titleBarStyle
 * Overlay），因此不画自绘按钮，只留出让位间距。
 */
export function isMacOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/** 是否需要自绘窗口按钮（浏览器预览里没有窗口可控制） */
export function needsWindowControls(): boolean {
  return isTauri() && !isMacOS();
}

async function currentWindow() {
  if (!isTauri()) return null;
  const mod = await import("@tauri-apps/api/window");
  return mod.getCurrentWindow();
}

export async function minimizeWindow(): Promise<void> {
  await (await currentWindow())?.minimize();
}

export async function toggleMaximizeWindow(): Promise<void> {
  await (await currentWindow())?.toggleMaximize();
}

export async function closeWindow(): Promise<void> {
  await (await currentWindow())?.close();
}

/** 当前是否处于最大化状态（用于切换「最大化 / 还原」图标） */
export async function queryMaximized(): Promise<boolean> {
  return (await currentWindow())?.isMaximized() ?? false;
}

/** 订阅窗口尺寸变化，返回取消订阅函数 */
export async function onWindowResized(cb: () => void): Promise<() => void> {
  const win = await currentWindow();
  if (!win) return () => {};
  return win.onResized(() => cb());
}

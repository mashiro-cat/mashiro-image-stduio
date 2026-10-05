import type { GenMode } from "../types";

/**
 * 生成模式 → 目标路由。
 * 文生图 / 图生图 属于同一个「大模型生图」页面，只是 query.mode 不同。
 * 单独成文件是为了避免视图层 import 路由实例造成循环依赖。
 */
export function studioRoute(mode: GenMode): { path: string; query?: Record<string, string> } {
  if (mode === "workflow") return { path: "/workflow" };
  return { path: "/generate", query: { mode } };
}

/* ==========================================================================
   平台层格式化 + 图片/媒体组件词条
   覆盖：platform/env.ts 的 formatRelative / sizeLabel / formatDuration，
        以及大图查看器（UiImageViewer）、智能图片（UiSmartImage）、
        通用 UI 组件（UiDrawer / UiModal / UiToastHost / UiSecretInput / UiTagInput）
        里的中文 title / placeholder。

   分组：time（相对时间）/ size（尺寸标签）/ duration（耗时）/
        viewer（大图查看器）/ input（通用输入组件）

   ⚠️ 已存在的 common.* 词条一律复用，不在这里重定义一份：
      关闭 common.close / common.closeTitle、复制 common.copy、
      适应窗口 common.fitWindow、原始尺寸 common.actualSize、
      上一张 common.prevImage、下一张 common.nextImage、
      图片无法加载 common.imageLoadFailed、图片加载中 common.imageLoading、
      显示 common.showTitle、隐藏 common.hideTitle。
      重复定义会在 locales.ts 合并时直接抛错。

   注意：单位符号（B / KB / MB / ms / s）与「1:1」是记号不是文案，不翻译。
   ========================================================================== */

import { definePart } from "../part";

export const media = definePart(
  {
    /* ---------------------------------------------------------- 相对时间 */
    // 超过 30 天回落到 formatTime 的绝对日期（2026-01-31），两种语言同构，不出词条
    "media.time.justNow": "刚刚",
    "media.time.minutesAgo": "{n} 分钟前",
    "media.time.hoursAgo": "{n} 小时前",
    "media.time.daysAgo": "{n} 天前",

    /* ---------------------------------------------------------- 尺寸标签 */
    "media.size.auto": "自动",

    /* ---------------------------------------------------------- 耗时 */
    "media.duration.minSec": "{m} 分 {s} 秒",

    /* ---------------------------------------------------------- 大图查看器 */
    // 关闭 / 上一张 / 下一张 / 适应窗口 / 原始尺寸 / 图片无法加载 复用 common.*
    "media.viewer.counter": "{index} / {total}",
    "media.viewer.dimensions": "{width} × {height}",

    /* ---------------------------------------------------------- 通用输入组件 */
    "media.input.tagPlaceholder": "输入后回车添加标签",
    "media.input.tagSuggestions": "常用：",
  },
  {
    /* ---------------------------------------------------------- 相对时间 */
    // 超过 30 天回落到 formatTime 的绝对日期（2026-01-31），两种语言同构，不出词条
    "media.time.justNow": "just now",
    "media.time.minutesAgo": "{n} min ago",
    "media.time.hoursAgo": "{n} hr ago",
    "media.time.daysAgo": "{n} days ago",

    /* ---------------------------------------------------------- 尺寸标签 */
    "media.size.auto": "Auto",

    /* ---------------------------------------------------------- 耗时 */
    "media.duration.minSec": "{m}m {s}s",

    /* ---------------------------------------------------------- 大图查看器 */
    // 关闭 / 上一张 / 下一张 / 适应窗口 / 原始尺寸 / 图片无法加载 复用 common.*
    "media.viewer.counter": "{index} / {total}",
    "media.viewer.dimensions": "{width} × {height}",

    /* ---------------------------------------------------------- 通用输入组件 */
    "media.input.tagPlaceholder": "Press Enter to add a tag",
    "media.input.tagSuggestions": "Common:",
  },
);

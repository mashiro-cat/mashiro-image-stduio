/* ==========================================================================
   调试抽屉词条：DebugLogDrawer + stores/debugLog.ts 的可见提示
   + platform/debug.ts 里会写进日志正文、需要人读懂的省略/脱敏标记。

   分组：title / subtitle / mode（调试开关）/ toolbar（搜索与筛选）/
        entry（单条日志的字段与分区）/ empty（空态）/ footer /
        action / toast / redact（脱敏与截断标记）

   注意：HTTP 方法名（GET / POST）、状态码、URL、NET / ms 这类
   都是**数据不是文案**，原样显示。platform/debug.ts 里的
   正则、掩码算法（maskSecret）同样不翻译，只有它吐出来的
   人类可读标记才在这里查表。
   ========================================================================== */

import { definePart } from "../part";

export const debug = definePart(
  {
    /* ---------------------------------------------------------- 标题与概要 */
    "debug.title": "请求日志",
    "debug.subtitle": "共 {total} 条 · 失败 {errors} 条",
    "debug.subtitleVerbose": "共 {total} 条 · 失败 {errors} 条 · 调试模式已开启",
    "debug.subtitleBasic": "共 {total} 条 · 失败 {errors} 条 · 仅精简记录",

    /* ---------------------------------------------------------- 调试模式开关 */
    "debug.mode.on": "已开启",
    "debug.mode.off": "未开启",
    "debug.mode.label": "调试模式",
    "debug.mode.notApplied": "未生效",
    "debug.mode.descOn": "正在记录请求数据、返回数据与请求头（API Key 自动脱敏）",
    "debug.mode.descOff": "当前只记录方法、状态码与耗时；开启后额外记录请求数据与返回数据",
    "debug.mode.descOffStrong": "请求数据与返回数据",
    "debug.mode.mismatch": "设置已打开但请求层未收到该开关，请关闭后再打开一次，或重启应用",

    /* ---------------------------------------------------------- 工具条 */
    "debug.toolbar.searchPlaceholder": "搜索 URL、来源或状态码…",
    "debug.toolbar.clearSearch": "清空",
    "debug.toolbar.onlyErrors": "只看失败",

    /* ---------------------------------------------------------- 单条日志字段 */
    "debug.entry.duration": "耗时",
    "debug.entry.timeout": "超时设置",
    "debug.entry.timeoutDefault": "默认（300s）",
    "debug.entry.level": "记录级别",
    "debug.entry.levelVerbose": "完整（调试模式）",
    "debug.entry.levelBasic": "精简",
    "debug.entry.url": "请求地址",

    /* ---------------------------------------------------------- 日志分区 */
    "debug.section.requestHeaders": "请求头",
    "debug.section.requestBody": "请求数据",
    "debug.section.requestBodyTruncated": "请求数据（已截断）",
    "debug.section.responseHeaders": "响应头",
    "debug.section.responseBody": "返回数据",
    "debug.section.responseBodyTruncated": "返回数据（已截断）",
    "debug.section.needsVerbose": "开启调试模式后可查看完整的请求与返回数据",

    /* ---------------------------------------------------------- 空态 */
    "debug.empty.noMatch": "没有匹配的日志",
    "debug.empty.noMatchDesc": "换个关键词试试",
    "debug.empty.title": "还没有请求记录",
    "debug.empty.demoDesc": "当前处于演示模式，不会发出真实请求",
    "debug.empty.idleDesc": "在工作台生成一次图片，这里就会出现对应的请求记录",

    /* ---------------------------------------------------------- 页脚 */
    "debug.footer.privacy": "日志仅保存在本机，导出前已对 API Key、Bearer Token 与 base64 内容做脱敏处理",

    /* ---------------------------------------------------------- 操作 */
    "debug.action.clear": "清空",
    "debug.action.export": "导出",
    "debug.action.copyFull": "复制完整日志（JSON）",
    "debug.action.debugSettings": "调试设置",

    /* ---------------------------------------------------------- 确认框 */
    "debug.confirm.clearTitle": "清空请求日志？",
    "debug.confirm.clearMessage": "仅清空本地调试日志，不影响历史记录与配置。",
    "debug.confirm.clearConfirm": "清空",

    /* ---------------------------------------------------------- 提示 */
    "debug.toast.entryCopied": "已复制该条日志",
    "debug.toast.exported": "已导出请求日志",
    "debug.toast.exportedDesc": "共 {count} 条，可直接发给技术支持",
    "debug.toast.cleared": "日志已清空",
    "debug.toast.modeOn": "调试模式已开启",
    "debug.toast.modeOnDesc": "下一次请求开始记录完整的请求数据与返回数据",
    "debug.toast.modeOff": "调试模式已关闭",
    "debug.toast.modeOffDesc": "新请求只保留方法、状态码与耗时",

    /* ---------------------------------------------------------- 脱敏与截断标记 */
    "debug.redact.queryOmitted": "?<已省略>",
    "debug.redact.tooDeep": "<层级过深已省略>",
    "debug.redact.value": "<已脱敏>",
    "debug.redact.dataUrl": "data:{mime};base64,<{count} 字符已省略>",
    "debug.redact.base64": "<base64 {count} 字符已省略>",
    "debug.redact.truncatedTail": "…<共 {count} 字符>",
    "debug.redact.bodyTruncated": "…<已截断，共 {count} 字符>",
    "debug.redact.binary": "<二进制内容已省略，可查看本地文件>",
  },
  {
    /* ---------------------------------------------------------- 标题与概要 */
    "debug.title": "Request log",
    "debug.subtitle": "{total} entries · {errors} failed",
    "debug.subtitleVerbose": "{total} entries · {errors} failed · debug mode on",
    "debug.subtitleBasic": "{total} entries · {errors} failed · basic records only",

    /* ---------------------------------------------------------- 调试模式开关 */
    "debug.mode.on": "on",
    "debug.mode.off": "off",
    "debug.mode.label": "Debug mode",
    "debug.mode.notApplied": "Not applied",
    "debug.mode.descOn": "Recording request bodies, responses and headers (API keys are masked)",
    "debug.mode.descOff": "Only method, status and duration are recorded; turn this on to also record request and response bodies",
    "debug.mode.descOffStrong": "request and response bodies",
    "debug.mode.mismatch": "The setting is on but the request layer never received it. Toggle it off and on again, or restart the app",

    /* ---------------------------------------------------------- 工具条 */
    "debug.toolbar.searchPlaceholder": "Search URL, source or status…",
    "debug.toolbar.clearSearch": "Clear",
    "debug.toolbar.onlyErrors": "Failed only",

    /* ---------------------------------------------------------- 单条日志字段 */
    "debug.entry.duration": "Duration",
    "debug.entry.timeout": "Timeout",
    "debug.entry.timeoutDefault": "Default (300s)",
    "debug.entry.level": "Verbosity",
    "debug.entry.levelVerbose": "Full (debug mode)",
    "debug.entry.levelBasic": "Basic",
    "debug.entry.url": "Request URL",

    /* ---------------------------------------------------------- 日志分区 */
    "debug.section.requestHeaders": "Request headers",
    "debug.section.requestBody": "Request body",
    "debug.section.requestBodyTruncated": "Request body (truncated)",
    "debug.section.responseHeaders": "Response headers",
    "debug.section.responseBody": "Response body",
    "debug.section.responseBodyTruncated": "Response body (truncated)",
    "debug.section.needsVerbose": "Turn on debug mode to see the full request and response bodies",

    /* ---------------------------------------------------------- 空态 */
    "debug.empty.noMatch": "No matching entries",
    "debug.empty.noMatchDesc": "Try a different keyword",
    "debug.empty.title": "No requests logged yet",
    "debug.empty.demoDesc": "Demo mode is on, so no real requests are sent",
    "debug.empty.idleDesc": "Generate an image in the studio and its request will show up here",

    /* ---------------------------------------------------------- 页脚 */
    "debug.footer.privacy": "Logs stay on this device. API keys, bearer tokens and base64 payloads are masked before export",

    /* ---------------------------------------------------------- 操作 */
    "debug.action.clear": "Clear",
    "debug.action.export": "Export",
    "debug.action.copyFull": "Copy full log (JSON)",
    "debug.action.debugSettings": "Debug settings",

    /* ---------------------------------------------------------- 确认框 */
    "debug.confirm.clearTitle": "Clear the request log?",
    "debug.confirm.clearMessage": "This only clears the local debug log. History and settings are untouched.",
    "debug.confirm.clearConfirm": "Clear",

    /* ---------------------------------------------------------- 提示 */
    "debug.toast.entryCopied": "Log entry copied",
    "debug.toast.exported": "Request log exported",
    "debug.toast.exportedDesc": "{count} entries, ready to send to support",
    "debug.toast.cleared": "Log cleared",
    "debug.toast.modeOn": "Debug mode on",
    "debug.toast.modeOnDesc": "The next request will record full request and response data",
    "debug.toast.modeOff": "Debug mode off",
    "debug.toast.modeOffDesc": "New requests keep only method, status and duration",

    /* ---------------------------------------------------------- 脱敏与截断标记 */
    "debug.redact.queryOmitted": "?<omitted>",
    "debug.redact.tooDeep": "<nesting too deep, omitted>",
    "debug.redact.value": "<redacted>",
    "debug.redact.dataUrl": "data:{mime};base64,<{count} chars omitted>",
    "debug.redact.base64": "<base64 {count} chars omitted>",
    "debug.redact.truncatedTail": "…<{count} chars total>",
    "debug.redact.bodyTruncated": "…<truncated, {count} chars total>",
    "debug.redact.binary": "<binary content omitted, see the local file>",
  },
);

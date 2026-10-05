/* ==========================================================================
   应用外壳词条：侧边栏（AppSidebar）+ 顶栏（AppTitlebar）+ 自绘窗口按钮
   （WindowControls）+ 路由标题（router/index.ts 的 meta.title）
   —— 侧边栏与顶栏的菜单项刻意分成两组 key：item.* 是入口本身的名字，
   route.* 是同一个页面的标题文案。两者中文相同但英文不同（导航用短名，
   标题用完整名），不要图省事合并成一个 key。

   分组：item / group（侧边栏）/ workspace（统计卡）/ window（窗口按钮）/
        brand / search（全局搜索）/ notice（动态菜单）/ menu（齿轮菜单）/
        status（菜单里的状态标签）/ action / route

   注意：路由路径（/generate、/upscale…）、图标名（home、sparkles…）、
   窗口按钮的行为标识都是**数据不是文案**，不翻译。
   ========================================================================== */

import { definePart } from "../part";

export const nav = definePart(
  {
    /* ---------------------------------------------------------- 侧边栏入口 */
    "nav.item.home": "首页",
    "nav.item.generate": "大模型生图",
    "nav.item.workflow": "工作流生图",
    "nav.item.upscale": "图片超分",
    "nav.item.prompts": "提示词库",
    "nav.item.history": "历史记录",
    "nav.item.settings": "设置",

    /* ---------------------------------------------------------- 侧边栏分组 */
    "nav.group.create": "创作",
    "nav.group.resource": "资源",
    "nav.group.preference": "偏好",

    /* ---------------------------------------------------------- 工作区统计卡 */
    "nav.workspace.title": "我的工作区",
    "nav.workspace.runs": "{n} 次生成",
    "nav.workspace.images": "{n} 张图",
    "nav.workspace.successRate": "成功率 {rate}%",

    /* ---------------------------------------------------------- 窗口按钮 */
    "nav.window.minimize": "最小化",
    "nav.window.maximize": "最大化",
    "nav.window.restore": "向下还原",
    "nav.window.close": "关闭",

    /* ---------------------------------------------------------- 品牌区与顶栏 */
    "nav.brand.tagline": "AI 生图工作台",
    "nav.action.backHome": "回到首页",
    "nav.action.toggleSidebar": "展开/收起侧边栏",
    "nav.action.collapseSidebar": "收起侧边栏",
    "nav.demo.badge": "演示模式",
    "nav.demo.tooltip": "未启用生图渠道，当前使用演示数据",

    /* ---------------------------------------------------------- 全局搜索 */
    "nav.search.placeholder": "搜索提示词、创作记录、项目…",
    "nav.search.modalPlaceholder": "搜索提示词与历史记录…",
    "nav.search.quickTitle": "快捷入口",
    "nav.search.groupPrompts": "提示词库",
    "nav.search.groupHistory": "历史记录",
    "nav.search.noResult": "没有匹配结果",
    "nav.search.noResultHint": "试着搜索「夜景」「产品」「人像」…",

    /* ---------------------------------------------------------- 动态菜单 */
    "nav.notice.title": "创作动态",
    "nav.notice.recentTitle": "最近动态",
    "nav.notice.empty": "还没有创作记录",
    "nav.notice.emptyPrompt": "（无提示词）",
    "nav.notice.viewAll": "查看全部记录",

    /* ---------------------------------------------------------- 齿轮菜单 */
    "nav.menu.title": "设置",
    "nav.menu.localFirst": "本地优先 · 全部数据保存在本机",
    "nav.menu.quickTitle": "快捷入口",
    "nav.menu.modelChannels": "生图渠道",
    "nav.menu.workflowChannels": "工作流渠道",
    "nav.menu.requestLog": "请求日志",
    "nav.menu.dataDir": "数据目录",
    "nav.menu.mcp": "MCP 服务",
    "nav.menu.upscale": "图片超分",
    "nav.menu.themeDark": "切换深色模式",
    "nav.menu.themeLight": "切换浅色模式",
    "nav.menu.openLog": "查看请求日志",
    "nav.menu.openDataDir": "打开数据目录",
    "nav.menu.prompts": "提示词库",
    "nav.menu.footnote": "Mashiro Studio v0.1.0 · 设置已收拢密钥、日志与本地数据",

    /* ---------------------------------------------------------- 菜单状态标签 */
    "nav.status.notEnabled": "未启用",
    "nav.status.failedCount": "失败 {n}",
    "nav.status.recording": "记录中",
    "nav.status.off": "未开启",
    "nav.status.running": "运行中",
    "nav.status.stopped": "已停止",
    "nav.status.modelMissing": "未下载模型",
    "nav.status.entryShown": "已显示",
    "nav.status.entryHidden": "已隐藏",

    /* ---------------------------------------------------------- 数据目录失败提示 */
    "nav.error.dataDirTitle": "无法打开数据目录",
    "nav.error.dataDirUnknown": "未知错误",
    "nav.error.dataDirBrowser": "浏览器预览模式下数据保存在浏览器本地存储中",

    /* ---------------------------------------------------------- 路由标题 */
    // 调试信息、窗口标题等处会显示它们，与 nav.item.* 是不同的展示场合
    "nav.route.home": "首页",
    "nav.route.generate": "大模型生图",
    "nav.route.workflow": "工作流生图",
    "nav.route.upscale": "图片超分",
    "nav.route.prompts": "提示词库",
    "nav.route.history": "历史记录",
    "nav.route.settings": "设置",
  },
  {
    /* ---------------------------------------------------------- 侧边栏入口 */
    "nav.item.home": "Home",
    "nav.item.generate": "Generate",
    "nav.item.workflow": "Workflow",
    "nav.item.upscale": "Upscale",
    "nav.item.prompts": "Prompts",
    "nav.item.history": "History",
    "nav.item.settings": "Settings",

    /* ---------------------------------------------------------- 侧边栏分组 */
    "nav.group.create": "Create",
    "nav.group.resource": "Library",
    "nav.group.preference": "Preferences",

    /* ---------------------------------------------------------- 工作区统计卡 */
    "nav.workspace.title": "My workspace",
    "nav.workspace.runs": "{n} runs",
    "nav.workspace.images": "{n} images",
    "nav.workspace.successRate": "{rate}% success",

    /* ---------------------------------------------------------- 窗口按钮 */
    "nav.window.minimize": "Minimize",
    "nav.window.maximize": "Maximize",
    "nav.window.restore": "Restore down",
    "nav.window.close": "Close",

    /* ---------------------------------------------------------- 品牌区与顶栏 */
    "nav.brand.tagline": "AI image studio",
    "nav.action.backHome": "Back to home",
    "nav.action.toggleSidebar": "Expand or collapse sidebar",
    "nav.action.collapseSidebar": "Collapse sidebar",
    "nav.demo.badge": "Demo",
    "nav.demo.tooltip": "No image channel enabled, showing demo data",

    /* ---------------------------------------------------------- 全局搜索 */
    "nav.search.placeholder": "Search prompts, creations, projects…",
    "nav.search.modalPlaceholder": "Search prompts and history…",
    "nav.search.quickTitle": "Quick jumps",
    "nav.search.groupPrompts": "Prompt library",
    "nav.search.groupHistory": "History",
    "nav.search.noResult": "No matches",
    "nav.search.noResultHint": "Try “night scene”, “product” or “portrait”…",

    /* ---------------------------------------------------------- 动态菜单 */
    "nav.notice.title": "Activity",
    "nav.notice.recentTitle": "Recent activity",
    "nav.notice.empty": "No creations yet",
    "nav.notice.emptyPrompt": "(no prompt)",
    "nav.notice.viewAll": "View all activity",

    /* ---------------------------------------------------------- 齿轮菜单 */
    "nav.menu.title": "Settings",
    "nav.menu.localFirst": "Local-first · all data stays on this device",
    "nav.menu.quickTitle": "Quick jumps",
    "nav.menu.modelChannels": "Image channels",
    "nav.menu.workflowChannels": "Workflow channels",
    "nav.menu.requestLog": "Request log",
    "nav.menu.dataDir": "Data folder",
    "nav.menu.mcp": "MCP service",
    "nav.menu.upscale": "Upscale",
    "nav.menu.themeDark": "Switch to dark mode",
    "nav.menu.themeLight": "Switch to light mode",
    "nav.menu.openLog": "Open request log",
    "nav.menu.openDataDir": "Open data folder",
    "nav.menu.prompts": "Prompt library",
    "nav.menu.footnote": "Mashiro Studio v0.1.0 · keys, logs and local data live in Settings",

    /* ---------------------------------------------------------- 菜单状态标签 */
    "nav.status.notEnabled": "Off",
    "nav.status.failedCount": "{n} failed",
    "nav.status.recording": "Recording",
    "nav.status.off": "Off",
    "nav.status.running": "Running",
    "nav.status.stopped": "Stopped",
    "nav.status.modelMissing": "No model",
    "nav.status.entryShown": "Shown",
    "nav.status.entryHidden": "Hidden",

    /* ---------------------------------------------------------- 数据目录失败提示 */
    "nav.error.dataDirTitle": "Could not open the data folder",
    "nav.error.dataDirUnknown": "Unknown error",
    "nav.error.dataDirBrowser": "In browser preview, data is kept in local storage",

    /* ---------------------------------------------------------- 路由标题 */
    "nav.route.home": "Home",
    "nav.route.generate": "Model generation",
    "nav.route.workflow": "Workflow generation",
    "nav.route.upscale": "Image upscale",
    "nav.route.prompts": "Prompt library",
    "nav.route.history": "History",
    "nav.route.settings": "Settings",
  },
);

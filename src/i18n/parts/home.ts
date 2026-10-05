/* ==========================================================================
   首页词条：HomeView（首屏入口 / 灵感推荐 / 统计 / 最近创作 / 配置引导）
   以及首页「灵感推荐 → 案例预览」这条流程里由 HomeView 自己发起的提示。

   分组：hero（首屏）/ entry（入口卡）/ inspire（灵感推荐）/ tag（标签）/
        stat（统计卡）/ recent（最近创作）/ empty（空态）/ notice（配置引导）/
        action / toast

   灵感推荐在没有可用案例图时**不画假封面**，而是显示
   「品牌浅渐变 + 分类图标 + 分类名」+ 虚线提示引导去拉仓库，
   这两种状态的文案都在 inspire.* / tag.* 里。

   不归这里的两处：
   - CATEGORY_ICON 的键（人像 / 场景 / 产品…）与灵感卡上显示的 item.category
     都是**仓库数据**，不是文案，翻译会与筛选结果对不上；
   - PromptPreviewModal 自身的标题、负向提示词、去生图等词条归 prompts.ts，
     这里只留「从首页点进去」这条流程独有的 toast。
   ========================================================================== */

import { definePart } from "../part";

export const home = definePart(
  {
    /* ---------------------------------------------------------- 首屏 */
    "home.title": "用想象，",
    "home.titleHighlight": "创造视觉的世界",
    "home.subtitle": "输入你的想法，开启 AI 创作之旅",

    /* ---------------------------------------------------------- 入口卡 */
    "home.entry.text2img": "文生图",
    "home.entry.text2imgSub": "输入文字描述，生成精美图像",
    "home.entry.img2img": "图生图",
    "home.entry.img2imgSub": "上传图片，基于图片进行创作",
    "home.entry.workflow": "工作流生图",
    "home.entry.workflowSub": "调用 RunningHub ComfyUI 工作流",
    "home.entry.prompts": "提示词库",
    "home.entry.promptsSub": "管理、增强、复用你的提示词",

    /* ---------------------------------------------------------- 灵感推荐 */
    "home.inspire.title": "灵感推荐",
    "home.inspire.reroll": "换一批",
    "home.inspire.more": "更多",
    "home.inspire.previewTitle": "查看案例图与提示词",
    "home.inspire.useTitle": "用这条提示词开始文生图",
    // 没有案例图、仓库也还没拉过时给出的引导
    "home.inspire.pullRepo": "拉取社区案例库后，这里会换成真实案例图",

    /* ---------------------------------------------------------- 灵感标签 */
    "home.tag.viewRelated": "查看「{tag}」相关提示词",

    /* ---------------------------------------------------------- 统计卡 */
    "home.stat.total": "累计生成",
    "home.stat.images": "产出图片",
    "home.stat.rate": "成功率",
    "home.stat.prompts": "提示词",
    "home.stat.unitTimes": "次",
    "home.stat.unitImage": "张",
    "home.stat.unitPrompt": "条",

    /* ---------------------------------------------------------- 最近创作 */
    "home.recent.title": "最近创作",
    "home.recent.subtitle": "点击任意作品即可复用其参数继续创作",
    "home.recent.viewAll": "查看全部",

    /* ---------------------------------------------------------- 空态 */
    "home.empty.title": "还没有创作记录",
    "home.empty.desc": "从上方入口开始第一次生成，结果会自动归档到历史记录中",

    /* ---------------------------------------------------------- 配置引导 */
    "home.notice.title": "还没有配置生图模型密钥",
    "home.notice.desc":
      "当前处于演示模式，生成的是占位图。填写生图模型 API Key、工作流 API Key 与 LLM Key 后即可调用真实模型。",
    "home.notice.action": "前往设置页",

    /* ---------------------------------------------------------- 操作 */
    "home.action.startText2img": "开始文生图",

    /* ---------------------------------------------------------- 提示 */
    "home.toast.copyFailed": "请手动选择文本复制",
    "home.toast.promptCopied": "已复制提示词",
    "home.toast.noSourceLink": "没有可打开的链接",
    "home.toast.noSourceLinkDesc": "该条目没有记录来源地址",
    "home.toast.paramsLoaded": "已载入参数",
    "home.toast.paramsLoadedDesc": "可以在工作台继续调整后重新生成",
  },
  {
    /* ---------------------------------------------------------- 首屏 */
    "home.title": "Imagine it,",
    "home.titleHighlight": "then make it visual",
    "home.subtitle": "Type an idea to start creating with AI",

    /* ---------------------------------------------------------- 入口卡 */
    "home.entry.text2img": "Text to image",
    "home.entry.text2imgSub": "Describe it in words and render an image",
    "home.entry.img2img": "Image to image",
    "home.entry.img2imgSub": "Upload a reference and build on it",
    "home.entry.workflow": "Workflow",
    "home.entry.workflowSub": "Run a RunningHub ComfyUI workflow",
    "home.entry.prompts": "Prompt library",
    "home.entry.promptsSub": "Organize, refine and reuse your prompts",

    /* ---------------------------------------------------------- 灵感推荐 */
    "home.inspire.title": "Inspiration",
    "home.inspire.reroll": "Shuffle",
    "home.inspire.more": "More",
    "home.inspire.previewTitle": "View sample images and prompt",
    "home.inspire.useTitle": "Start text-to-image with this prompt",
    // 没有案例图、仓库也还没拉过时给出的引导
    "home.inspire.pullRepo": "Pull the community gallery to show real samples here",

    /* ---------------------------------------------------------- 灵感标签 */
    "home.tag.viewRelated": "View prompts tagged “{tag}”",

    /* ---------------------------------------------------------- 统计卡 */
    "home.stat.total": "Generations",
    "home.stat.images": "Images",
    "home.stat.rate": "Success rate",
    "home.stat.prompts": "Prompts",
    "home.stat.unitTimes": "times",
    "home.stat.unitImage": "",
    "home.stat.unitPrompt": "",

    /* ---------------------------------------------------------- 最近创作 */
    "home.recent.title": "Recent work",
    "home.recent.subtitle": "Click any result to reuse its settings",
    "home.recent.viewAll": "View all",

    /* ---------------------------------------------------------- 空态 */
    "home.empty.title": "No creations yet",
    "home.empty.desc": "Start your first run from an entry above — results are archived to History automatically",

    /* ---------------------------------------------------------- 配置引导 */
    "home.notice.title": "No image model key configured",
    "home.notice.desc":
      "Demo mode is on, so images are placeholders. Add an image model API key, a workflow API key and an LLM key to call real models.",
    "home.notice.action": "Open settings",

    /* ---------------------------------------------------------- 操作 */
    "home.action.startText2img": "Start text to image",

    /* ---------------------------------------------------------- 提示 */
    "home.toast.copyFailed": "Select the text and copy it manually",
    "home.toast.promptCopied": "Prompt copied",
    "home.toast.noSourceLink": "No link to open",
    "home.toast.noSourceLinkDesc": "This entry has no source URL",
    "home.toast.paramsLoaded": "Settings loaded",
    "home.toast.paramsLoadedDesc": "Adjust them in the studio, then generate again",
  },
);

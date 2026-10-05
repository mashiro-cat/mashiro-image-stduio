// ==========================================================================
//   工作流生图词条：WorkflowView + workbench/WorkflowImageSlot
//   以及 stores/settings.ts 里工作流选择器 / 渠道相关的那部分文案
//   —— 大模型生图见 studio.ts；增强结果面板（EnhanceResult）两边共用 studio.enhance.*。
//
//   分组：title / preset（选择器）/ role（输入槽位）/ input（槽位动作）/
//        run（提交与运行）/ status（任务状态）/ empty（空态）/ image（图片槽位）/ toast
//
//   注意：节点 ID、节点字段名（text / image / seed / steps）、实例类型
//   default / plus / ultra、状态机枚举（idle/queued/running/...）都是**数据不是文案**。
//   本文件为它们提供展示用 key（workflow.role.*、workflow.preset.instance.*），
//   调用方在渲染期 t() 查表，磁盘上存的仍是原始值——尤其 role 标签会被
//   relabelInputs() 拼成「输入图片 2」持久化进预设，绝不能翻译后写回。
//   ==========================================================================

import { definePart } from "../part";

export const workflow = definePart(
  {
    /* ---------------------------------------------------------- 标题栏 */
    "workflow.title": "工作流生图",
    "workflow.resultTitle": "工作流结果",
    "workflow.noPresetSelected": "尚未选择工作流",
    "workflow.empty.hintFillThenRun": "左侧填好参数后点「开始生成」，任务结果会自动保存到本地",

    /* ---------------------------------------------------------- 工作流选择器 */
    "workflow.preset.select": "选择工作流",
    "workflow.preset.current": "当前工作流",
    "workflow.preset.searchPlaceholder": "搜索工作流名称或 ID",
    "workflow.preset.inputCount": "{count} 项输入",
    "workflow.preset.idMissing": "未填写",
    "workflow.preset.idLine": "ID {id} · {count} 项输入",
    "workflow.preset.noMatch": "没有匹配的工作流",
    "workflow.preset.empty": "当前渠道还没有工作流",
    "workflow.preset.manage": "管理工作流",
    "workflow.preset.channelCount": "{name} · {count} 个工作流",
    "workflow.preset.switchChannel": "选择工作流渠道",

    // 实例类型 default / plus / ultra 是数据，界面只展示显存规格
    "workflow.preset.instance.default": "24G",
    "workflow.preset.instance.plus": "48G",
    "workflow.preset.instance.ultra": "84G",

    /* ---------------------------------------------------------- 输入槽位角色 */
    "workflow.role.positive": "正向提示词",
    "workflow.role.negative": "负向提示词",
    "workflow.role.image": "输入图片",
    "workflow.role.seed": "随机种子",
    "workflow.role.steps": "采样步数",
    // 单字缩写，用于极窄的槽位头
    "workflow.role.positiveShort": "正",
    "workflow.role.negativeShort": "负",
    "workflow.role.imageShort": "图",
    "workflow.role.seedShort": "种",
    "workflow.role.stepsShort": "步",

    /* ---------------------------------------------------------- 槽位动作 */
    "workflow.input.enhance": "AI 增强提示词",
    "workflow.input.saveToLibrary": "存入提示词库",
    "workflow.input.clear": "清空",
    "workflow.input.randomSeed": "随机种子",
    "workflow.input.positivePlaceholder": "描述你想要的画面，也可以用上方的 AI 增强按钮",
    "workflow.input.negativePlaceholder": "不希望出现的内容，例如：lowres, bad hands, watermark",
    "workflow.input.numberPlaceholder": "留空则用工作流默认",
    "workflow.input.nodeBadge": "#{node} · {field}",
    "workflow.input.sharedWithStudio": "与「大模型生图」共用同一份提示词",

    /* ---------------------------------------------------------- 提交与运行 */
    "workflow.run.start": "开始生成",
    "workflow.run.running": "执行中…",
    "workflow.run.cancel": "取消",
    "workflow.run.queued": "等待调度…",
    "workflow.run.noPreset.title": "请先选择工作流",
    "workflow.run.noPreset.desc": "在顶部选择一个 RunningHub 工作流，或到设置页新建",
    "workflow.run.notReady.title": "工作流未就绪",
    "workflow.run.notReady.desc": "请在「设置 · 工作流渠道」启用渠道并填写 API Key",

    /* ---------------------------------------------------------- 任务状态 */
    "workflow.status.idle": "待运行",
    "workflow.status.queued": "排队中",
    "workflow.status.running": "执行中",
    "workflow.status.success": "已完成",
    "workflow.status.failed": "失败",
    "workflow.status.canceled": "已取消",
    "workflow.status.taskId": "任务 ID {id}",
    "workflow.status.copyTaskId": "复制任务 ID",

    /* ---------------------------------------------------------- 空态 */
    "workflow.empty.noChannel.title": "还没有可用的工作流渠道",
    "workflow.empty.noChannel.desc": "到「设置 · 工作流渠道」启用渠道并填写 API Key",
    "workflow.empty.noChannel.action": "前往设置",
    "workflow.empty.noPreset.title": "当前渠道还没有工作流",
    "workflow.empty.noPreset.desc": "添加 RunningHub 工作流 ID，点「识别节点」后即可在这里使用",
    "workflow.empty.noPreset.action": "新建工作流",
    "workflow.empty.noSlots.title": "「{name}」还没有输入槽位",
    "workflow.empty.noSlots.desc":
      "这个工作流不向外暴露可填参数，会直接按工作流里的默认值执行；也可以到设置页识别节点后重新配置",
    "workflow.empty.noSlots.action": "去配置输入",

    /* ---------------------------------------------------------- 图片槽位 */
    "workflow.image.selected": "已选择图片",
    "workflow.image.replace": "更换",
    "workflow.image.remove": "移除",
    "workflow.image.upload": "点击或拖拽上传图片",
    "workflow.image.accept": "PNG / JPG / WEBP",

    /* ---------------------------------------------------------- 提示消息 */
    "workflow.toast.imageSaved": "已保存图片",
    "workflow.toast.saveFailed.title": "保存失败",
    "workflow.toast.saveFailed.desc": "无法读取图片内容",
    "workflow.toast.taskIdCopied": "任务 ID 已复制",
  },
  {
    /* ---------------------------------------------------------- 标题栏 */
    "workflow.title": "Workflow",
    "workflow.resultTitle": "Workflow result",
    "workflow.noPresetSelected": "No workflow selected",
    "workflow.empty.hintFillThenRun":
      "Fill the inputs on the left and hit “Start generating” — results are saved locally",

    /* ---------------------------------------------------------- 工作流选择器 */
    "workflow.preset.select": "Select a workflow",
    "workflow.preset.current": "Current workflow",
    "workflow.preset.searchPlaceholder": "Search by workflow name or ID",
    "workflow.preset.inputCount": "{count} inputs",
    "workflow.preset.idMissing": "not set",
    "workflow.preset.idLine": "ID {id} · {count} inputs",
    "workflow.preset.noMatch": "No matching workflow",
    "workflow.preset.empty": "This channel has no workflows yet",
    "workflow.preset.manage": "Manage workflows",
    "workflow.preset.channelCount": "{name} · {count} workflows",
    "workflow.preset.switchChannel": "Select workflow channel",

    // 实例类型 default / plus / ultra 是数据，界面只展示显存规格
    "workflow.preset.instance.default": "24G",
    "workflow.preset.instance.plus": "48G",
    "workflow.preset.instance.ultra": "84G",

    /* ---------------------------------------------------------- 输入槽位角色 */
    "workflow.role.positive": "Positive prompt",
    "workflow.role.negative": "Negative prompt",
    "workflow.role.image": "Input image",
    "workflow.role.seed": "Seed",
    "workflow.role.steps": "Steps",
    // 单字缩写，用于极窄的槽位头
    "workflow.role.positiveShort": "P",
    "workflow.role.negativeShort": "N",
    "workflow.role.imageShort": "I",
    "workflow.role.seedShort": "S",
    "workflow.role.stepsShort": "T",

    /* ---------------------------------------------------------- 槽位动作 */
    "workflow.input.enhance": "Enhance prompt with AI",
    "workflow.input.saveToLibrary": "Save to prompt library",
    "workflow.input.clear": "Clear",
    "workflow.input.randomSeed": "Randomize seed",
    "workflow.input.positivePlaceholder":
      "Describe the scene you want, or use the AI enhance button above",
    "workflow.input.negativePlaceholder": "What you don't want, e.g. lowres, bad hands, watermark",
    "workflow.input.numberPlaceholder": "Leave blank for the workflow default",
    "workflow.input.nodeBadge": "#{node} · {field}",
    "workflow.input.sharedWithStudio": "Shares one prompt with “Text to image”",

    /* ---------------------------------------------------------- 提交与运行 */
    "workflow.run.start": "Start generating",
    "workflow.run.running": "Running…",
    "workflow.run.cancel": "Cancel",
    "workflow.run.queued": "Waiting to be scheduled…",
    "workflow.run.noPreset.title": "Select a workflow first",
    "workflow.run.noPreset.desc": "Pick a RunningHub workflow at the top, or create one in Settings",
    "workflow.run.notReady.title": "Workflow not ready",
    "workflow.run.notReady.desc":
      "Enable a channel and enter its API key in Settings · Workflow channels",

    /* ---------------------------------------------------------- 任务状态 */
    "workflow.status.idle": "Not started",
    "workflow.status.queued": "Queued",
    "workflow.status.running": "Running",
    "workflow.status.success": "Completed",
    "workflow.status.failed": "Failed",
    "workflow.status.canceled": "Canceled",
    "workflow.status.taskId": "Task ID {id}",
    "workflow.status.copyTaskId": "Copy task ID",

    /* ---------------------------------------------------------- 空态 */
    "workflow.empty.noChannel.title": "No workflow channel available",
    "workflow.empty.noChannel.desc": "Enable a channel and enter its API key in Settings · Workflow channels",
    "workflow.empty.noChannel.action": "Open Settings",
    "workflow.empty.noPreset.title": "This channel has no workflows yet",
    "workflow.empty.noPreset.desc":
      "Add a RunningHub workflow ID, then hit “Detect nodes” to use it here",
    "workflow.empty.noPreset.action": "New workflow",
    "workflow.empty.noSlots.title": "“{name}” has no input slots",
    "workflow.empty.noSlots.desc":
      "This workflow exposes no fillable parameters and will run on its built-in defaults — you can detect nodes in Settings to reconfigure it",
    "workflow.empty.noSlots.action": "Configure inputs",

    /* ---------------------------------------------------------- 图片槽位 */
    "workflow.image.selected": "Image selected",
    "workflow.image.replace": "Replace",
    "workflow.image.remove": "Remove",
    "workflow.image.upload": "Click or drag an image here",
    "workflow.image.accept": "PNG / JPG / WEBP",

    /* ---------------------------------------------------------- 提示消息 */
    "workflow.toast.imageSaved": "Image saved",
    "workflow.toast.saveFailed.title": "Save failed",
    "workflow.toast.saveFailed.desc": "The image data could not be read",
    "workflow.toast.taskIdCopied": "Task ID copied",
  },
);

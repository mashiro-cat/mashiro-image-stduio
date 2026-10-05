// ==========================================================================
//   大模型生图工作台词条：ModelStudioView + workbench/PromptPanel、PreviewStage、
//   ModelParamsPanel、EnhanceResult、ReferenceInput
//   —— 项目主界面，文案量最大的一域。工作流生图见 workflow.ts。
//
//   分组：mode / channel / prompt / params / preview / enhance / reverse /
//        reference / action / toast
//
//   注意：模型名、节点字段名（text/image/seed/steps）、画质枚举值、尺寸像素、
//   状态机枚举（idle/queued/running/...）都是**数据不是文案**，不要翻译。
//   本文件为它们提供的是**展示用 key**（如 params.quality.high），
//   由调用方在渲染期 t() 查表，磁盘上存的仍是原始枚举值。
//   ==========================================================================

import { definePart } from "../part";

export const studio = definePart(
  {
    /* ---------------------------------------------------------- 模式切换 */
    "studio.mode.text2img": "文生图",
    "studio.mode.img2img": "图生图",
    "studio.mode.hint.text2img": "只凭文字描述就能生成画面，可直接投入创作",
    "studio.mode.hint.img2img": "上传参考图并在原图基础上改写画面",

    /* ---------------------------------------------------------- 渠道 / LLM */
    "studio.channel.select": "选择生图渠道",
    "studio.channel.demo": "演示模式",
    "studio.channel.none": "未启用生图渠道",
    "studio.channel.modelUnset": "未设置模型",
    "studio.llm.thinkingOn": "思考模式",
    "studio.llm.thinkingOff": "已关闭思考",

    /* ---------------------------------------------------------- 提示词面板 */
    "studio.prompt.tab": "提示词",
    "studio.prompt.tabEnhance": "增强",
    "studio.prompt.positive": "正向提示词",
    "studio.prompt.positivePlaceholder":
      "描述你想要的画面，例如：一个穿着白色风衣的少女走在东京雨夜街头，霓虹灯反射在湿滑路面，电影感光线，35mm 镜头…",
    "studio.prompt.charCount": "{count} 字",
    "studio.prompt.saveToLibrary": "存入提示词库",
    "studio.prompt.clear": "清空",
    "studio.prompt.noStyle": "未附加风格预设",
    "studio.prompt.removeStyle": "移除风格",

    // 结构化拆解：6 个字段名是数据侧的固定槽位，这里给的是展示名与输入提示
    "studio.prompt.structured.title": "提示词结构化",
    "studio.prompt.structured.filled": "{filled}/6 已填",
    "studio.prompt.structured.compose": "拼成提示词",
    "studio.prompt.structured.clear": "清空",
    "studio.prompt.structured.hint": "把想法拆成可控变量，增强或手动填写都会同步到这里",
    "studio.prompt.field.subject": "主体",
    "studio.prompt.field.subjectPlaceholder": "画面核心对象",
    "studio.prompt.field.scene": "场景",
    "studio.prompt.field.scenePlaceholder": "所处环境与背景",
    "studio.prompt.field.style": "风格",
    "studio.prompt.field.stylePlaceholder": "写实 / 插画 / 3D…",
    "studio.prompt.field.lens": "镜头",
    "studio.prompt.field.lensPlaceholder": "焦段与构图",
    "studio.prompt.field.lighting": "光线",
    "studio.prompt.field.lightingPlaceholder": "光源方向与质感",
    "studio.prompt.field.color": "色彩",
    "studio.prompt.field.colorPlaceholder": "色调与配色倾向",

    "studio.prompt.negative.title": "负面提示词",
    "studio.prompt.negative.optional": "（可选）",
    "studio.prompt.negative.placeholder": "例如：低分辨率、模糊、多余手指、水印、文字、过曝…",

    /* ---------------------------------------------------------- 增强入口 */
    "studio.enhance.entryTitle": "AI 提示词增强",
    "studio.enhance.entrySub": "补全细节、生成负向词并结构化拆解",
    "studio.enhance.entrySubNoLlm": "需要在设置页配置 LLM 模型",
    "studio.enhance.recommended": "推荐",
    "studio.enhance.panelTitle": "提示词智能增强",
    "studio.enhance.desc":
      "基于 LLM（openai-completions 协议）把一句话想法扩写为完整提示词，并自动生成负向词与结构化拆解；结果需确认后才替换原提示词",
    "studio.enhance.ready": "已就绪",
    "studio.enhance.demoBadge": "演示增强",
    "studio.enhance.notConfigured": "未配置",
    "studio.enhance.demoTarget": "演示增强（未调用真实模型）",
    "studio.enhance.metaModel": "调用模型",
    "studio.enhance.metaReferences": "参考图",
    "studio.enhance.refNoneDemo": "演示增强不发送图片",
    "studio.enhance.refDisabled": "已在设置页关闭「发送参考图」",
    "studio.enhance.refAttached": "已随本次请求附带 {count} 张（压缩后发送）",
    "studio.enhance.refPlanned": "将附带 {count} 张参考图（矢量图自动跳过）",
    "studio.enhance.refNone": "当前没有参考图，仅发送文本",
    "studio.enhance.currentInput": "当前输入",
    "studio.enhance.currentInputEmpty": "（请先填写正向提示词）",
    "studio.enhance.run": "立即增强提示词",
    "studio.enhance.rerun": "重新增强",
    "studio.enhance.running": "正在增强…",
    "studio.enhance.or": "或",
    "studio.enhance.needSettingsPrefix": "前往",
    "studio.enhance.needSettingsLink": "设置页",
    "studio.enhance.needSettingsSuffix": "配置 LLM 模型，或开启演示模式",

    /* ------------------------------------------ 反推（EnhanceResult 的另一形态） */
    "studio.reverse.run": "从参考图反推提示词",
    "studio.reverse.running": "正在看图…",
    "studio.reverse.title": "让多模态模型看图，反推一条可复现的提示词",
    "studio.reverse.needReference": "需要先在左侧上传参考图",
    "studio.reverse.hintEmpty":
      "看图写词需要参考图：切到「图生图」并在左侧上传 1~4 张图片，不需要先写提示词",
    "studio.reverse.hintWith": "让多模态模型观察这 {count} 张参考图，反推出一条能复现它的提示词（不需要先写提示词）",

    /* ------------------------------------------- 增强结果（EnhanceResult: enhance） */
    "studio.enhance.resultTitle": "增强结果",
    "studio.enhance.appliedTag": "已采纳",
    "studio.enhance.pendingTag": "待确认",
    "studio.enhance.before": "增强前",
    "studio.enhance.after": "增强后",
    "studio.enhance.originalEmpty": "（原始提示词）",
    "studio.enhance.negativeLabel": "负向提示词",
    "studio.enhance.structuredLabel": "结构化拆解",
    "studio.enhance.notesLabel": "本次改动",
    "studio.enhance.apply": "采纳并替换原提示词",
    "studio.enhance.applyDone": "已采纳",
    "studio.enhance.discard": "放弃",
    "studio.enhance.hintPending": "未采纳前，原提示词不会被改动。",
    "studio.enhance.hintApplied": "当前已使用增强后的提示词，可以直接提交生成。",

    /* ------------------------------------- 反推结果（EnhanceResult: reverse） */
    "studio.reverse.resultTitle": "反推结果",
    "studio.reverse.promptLabel": "反推出的提示词",
    "studio.reverse.apply": "采纳并填入工作台",
    "studio.reverse.hintPending": "未采纳前，工作台上的提示词不会被改动。",
    "studio.reverse.hintApplied": "反推结果已填入工作台，现在可以直接提交生成。",

    /* ---------------------------------------------------------- 模型选择 */
    "studio.params.model.title": "当前模型",
    "studio.params.model.demo": "演示",
    "studio.params.model.optionCount": "{count} 个可选",
    "studio.params.model.none": "未选择模型",
    "studio.params.model.switch": "点击切换模型",
    "studio.params.model.searchPlaceholder": "搜索模型…",
    "studio.params.model.noMatch": "没有匹配的模型",
    "studio.params.model.settingsLink": "设置页",
    "studio.params.model.settingsFoot": "维护模型列表与 API Key",
    "studio.params.model.protocol": "OpenAI Images 协议",

    /* ---------------------------------------------------------- 风格预设 */
    "studio.params.style.title": "风格预设",
    "studio.params.style.clear": "清除",

    /* ---------------------------------------------------------- 画幅 / 尺寸 */
    "studio.params.aspect.title": "图片比例",
    "studio.params.aspect.auto": "自动",
    "studio.params.aspect.autoHint": "由模型按提示词自行决定画幅，不限制尺寸",
    "studio.params.aspect.square": "方形",
    "studio.params.aspect.landscape": "横版",
    "studio.params.aspect.portrait": "竖版",
    "studio.params.aspect.wide": "宽屏",
    "studio.params.aspect.square2k": "2K 方",
    "studio.params.aspect.uhdLandscape": "4K 横",
    "studio.params.size.auto": "自动",
    "studio.params.size.custom": "自定义尺寸",
    "studio.params.size.customPlaceholder": "例如 1792x1024",
    "studio.params.size.autoUsedHint": "不指定像素尺寸，由模型按提示词决定画幅；上游不支持时会自动改为不传尺寸",

    /* ---------------------------------------------------------- 数量 / 画质 */
    "studio.params.count.title": "生成数量",
    "studio.params.count.range": "1 – 10 张",
    "studio.params.count.suffix": "张",
    "studio.params.advanced.title": "高级设置",
    "studio.params.quality.title": "画质档位",
    "studio.params.quality.auto": "自动",
    "studio.params.quality.autoHint": "由服务端决定",
    "studio.params.quality.high": "高",
    "studio.params.quality.highHint": "细节最佳，耗时更长",
    "studio.params.quality.medium": "中",
    "studio.params.quality.mediumHint": "平衡画质与速度",
    "studio.params.quality.low": "低",
    "studio.params.quality.lowHint": "快速出草图",

    /* ---------------------------------------------------------- 种子 / 步数 */
    "studio.params.seed.label": "随机种子",
    "studio.params.seed.placeholder": "留空随机",
    "studio.params.seed.random": "随机一个种子",
    "studio.params.steps.label": "采样步数",
    "studio.params.steps.placeholder": "跟随工作流默认值",

    /* ---------------------------------------------------------- 预览区 */
    "studio.preview.title": "生成结果",
    "studio.preview.status.idle": "待生成",
    "studio.preview.status.queued": "排队中…",
    "studio.preview.status.running": "生成中…",
    "studio.preview.status.success": "已完成 · {count} 张",
    "studio.preview.status.failed": "生成失败",
    "studio.preview.status.canceled": "已取消",
    "studio.preview.empty.canvas": "画布还是空的",
    "studio.preview.empty.hint":
      "填写提示词后点击「生成图片」，结果会显示在这里",
    "studio.preview.empty.hintText2img": "左侧调参数，右侧写提示词，然后点击「生成图片」",
    "studio.preview.empty.hintImg2img": "左侧上传参考图并描述想要的修改，生成结果会显示在这里",
    "studio.preview.running.taskSubmitted": "任务已提交 · 预计产出 {count} 张",
    "studio.preview.running.sizeAndCount": "尺寸 {size} · {count} 张",
    "studio.preview.action.download": "下载当前图片",
    "studio.preview.action.reveal": "在文件管理器中显示",
    "studio.preview.action.clear": "清空画面",
    "studio.preview.action.expand": "放大查看",
    "studio.preview.action.prev": "上一张",
    "studio.preview.action.next": "下一张",
    "studio.preview.action.reuse": "继续生成一组",
    "studio.preview.promptSection": "提示词",
    "studio.preview.copyPrompt": "复制提示词",
    "studio.preview.editPrompt": "回到提示词面板编辑",
    "studio.preview.promptEmpty": "（暂无提示词）",
    "studio.preview.negativeLabel": "负向：",
    "studio.preview.counter": "{index} / {total}",

    /* ---------------------------------------------------------- 本地超分 */
    "studio.preview.upscale.running": "正在超分…",
    "studio.preview.upscale.needEnable": "请先在设置页 · 本地超分里开启",
    "studio.preview.upscale.needModel": "请先在设置页 · 本地超分里下载模型",
    "studio.preview.upscale.noLocalFile": "该图片没有本地文件，无法超分",
    "studio.preview.upscale.ready": "用 {model} 放大 {scale} 倍",
    "studio.preview.upscale.modelFallback": "本地模型",

    /* ---------------------------------------------------------- 底部动作 */
    "studio.action.generate": "生成图片",
    "studio.action.cancel": "取消生成",
    "studio.action.footDemo": "演示模式：将生成占位图，用于体验完整流程",
    "studio.action.footRunTarget": "将调用 {target} · 快捷键 Ctrl + Enter",
    "studio.action.footNoChannel": "尚未启用任何生图渠道，可在右上角「设置」中配置",
    "studio.action.apply": "应用",

    /* ---------------------------------------------------------- 参考图 */
    "studio.reference.label": "输入图片",
    "studio.reference.count": "{current}/{max}",
    "studio.reference.clear": "清空",
    "studio.reference.upload": "点击或拖拽上传图片",
    "studio.reference.formats": "PNG / JPG / WEBP · 最多 {max} 张",
    "studio.reference.remove": "移除",
    "studio.reference.addMore": "继续添加",
    "studio.reference.hint": "模型将以该图为基础，按提示词改写画面；建议与目标尺寸保持相近比例",

    /* ---------------------------------------------------------- 提示消息 */
    "studio.toast.promptEmpty.title": "提示词为空",
    "studio.toast.promptEmpty.descText2img": "先描述你想要的画面",
    "studio.toast.promptEmpty.descImg2img": "描述你希望在原图基础上如何修改",
    "studio.toast.noReference.title": "缺少参考图",
    "studio.toast.noReference.desc": "请先在左侧上传一张图片",
    "studio.toast.imageSaved": "已保存图片",
    "studio.toast.saveFailed.title": "保存失败",
    "studio.toast.saveFailed.desc": "无法读取图片内容",
    "studio.toast.promptCopied": "提示词已复制",
    "studio.toast.copyFailed.title": "复制失败",
    "studio.toast.copyFailed.desc": "请手动选择文本复制",
    "studio.toast.noLocalFile.title": "该图片没有本地文件",
    "studio.toast.noLocalFile.demo": "演示模式生成的是占位图，不会落盘",
    "studio.toast.noLocalFile.checkSetting": "可在设置页检查图片落盘设置",
    "studio.toast.revealDone": "已在文件管理器中定位",
    "studio.toast.revealFailed.title": "没能定位到这张图",
    "studio.toast.revealFailed.desktopOnly": "仅桌面端可用",
    "studio.toast.upscaleDone.title": "已放大到 {width}×{height}",
    "studio.toast.upscaleDone.desc": "耗时 {seconds} 秒 · 产物已追加到结果区",
    "studio.toast.upscaleFailed.title": "本地超分失败",
    "studio.toast.enhancing": "正在调用 LLM 增强提示词…",
    "studio.toast.reversing": "正在看图反推提示词…",
  },
  {
    /* ---------------------------------------------------------- 模式切换 */
    "studio.mode.text2img": "Text to image",
    "studio.mode.img2img": "Image to image",
    "studio.mode.hint.text2img": "Generate straight from a text description, ready to use",
    "studio.mode.hint.img2img": "Upload a reference and repaint it from your prompt",

    /* ---------------------------------------------------------- 渠道 / LLM */
    "studio.channel.select": "Select image channel",
    "studio.channel.demo": "Demo mode",
    "studio.channel.none": "No image channel enabled",
    "studio.channel.modelUnset": "No model set",
    "studio.llm.thinkingOn": "Thinking on",
    "studio.llm.thinkingOff": "Thinking off",

    /* ---------------------------------------------------------- 提示词面板 */
    "studio.prompt.tab": "Prompt",
    "studio.prompt.tabEnhance": "Enhance",
    "studio.prompt.positive": "Positive prompt",
    "studio.prompt.positivePlaceholder":
      "Describe the scene, e.g. a girl in a white trench coat walking a rainy Tokyo street, neon reflecting off wet asphalt, cinematic lighting, 35mm lens…",
    "studio.prompt.charCount": "{count} chars",
    "studio.prompt.saveToLibrary": "Save to prompt library",
    "studio.prompt.clear": "Clear",
    "studio.prompt.noStyle": "No style preset applied",
    "studio.prompt.removeStyle": "Remove style",

    // 结构化拆解：6 个字段名是数据侧的固定槽位，这里给的是展示名与输入提示
    "studio.prompt.structured.title": "Structured prompt",
    "studio.prompt.structured.filled": "{filled}/6 filled",
    "studio.prompt.structured.compose": "Merge into prompt",
    "studio.prompt.structured.clear": "Clear",
    "studio.prompt.structured.hint":
      "Break the idea into controllable parts — enhancing or manual edits both sync back here",
    "studio.prompt.field.subject": "Subject",
    "studio.prompt.field.subjectPlaceholder": "The core of the frame",
    "studio.prompt.field.scene": "Scene",
    "studio.prompt.field.scenePlaceholder": "Surroundings and background",
    "studio.prompt.field.style": "Style",
    "studio.prompt.field.stylePlaceholder": "Photo / illustration / 3D…",
    "studio.prompt.field.lens": "Lens",
    "studio.prompt.field.lensPlaceholder": "Focal length and framing",
    "studio.prompt.field.lighting": "Lighting",
    "studio.prompt.field.lightingPlaceholder": "Direction and quality of light",
    "studio.prompt.field.color": "Color",
    "studio.prompt.field.colorPlaceholder": "Tone and palette",

    "studio.prompt.negative.title": "Negative prompt",
    "studio.prompt.negative.optional": "(optional)",
    "studio.prompt.negative.placeholder": "E.g. lowres, blurry, extra fingers, watermark, text, overexposed…",

    /* ---------------------------------------------------------- 增强入口 */
    "studio.enhance.entryTitle": "AI prompt enhancement",
    "studio.enhance.entrySub": "Fills in detail, writes a negative prompt and structures the result",
    "studio.enhance.entrySubNoLlm": "Requires an LLM model in Settings",
    "studio.enhance.recommended": "Recommended",
    "studio.enhance.panelTitle": "Smart prompt enhancement",
    "studio.enhance.desc":
      "Expands a one-line idea into a full prompt via an LLM (openai-completions), and generates a negative prompt plus a structured breakdown. Your original prompt is only replaced after you confirm.",
    "studio.enhance.ready": "Ready",
    "studio.enhance.demoBadge": "Demo enhance",
    "studio.enhance.notConfigured": "Not configured",
    "studio.enhance.demoTarget": "Demo enhancement (no real model called)",
    "studio.enhance.metaModel": "Model",
    "studio.enhance.metaReferences": "Reference images",
    "studio.enhance.refNoneDemo": "Demo enhancement sends no images",
    "studio.enhance.refDisabled": "“Send reference images” is off in Settings",
    "studio.enhance.refAttached": "{count} attached to this request (sent compressed)",
    "studio.enhance.refPlanned": "{count} reference image(s) will be sent (vector art is skipped)",
    "studio.enhance.refNone": "No reference images — text only",
    "studio.enhance.currentInput": "Current input",
    "studio.enhance.currentInputEmpty": "(Write a positive prompt first)",
    "studio.enhance.run": "Enhance prompt",
    "studio.enhance.rerun": "Enhance again",
    "studio.enhance.running": "Enhancing…",
    "studio.enhance.or": "or",
    "studio.enhance.needSettingsPrefix": "Go to ",
    "studio.enhance.needSettingsLink": "Settings",
    "studio.enhance.needSettingsSuffix": "to configure an LLM model, or turn on demo mode",

    /* ------------------------------------------ 反推（EnhanceResult 的另一形态） */
    "studio.reverse.run": "Derive prompt from image",
    "studio.reverse.running": "Reading image…",
    "studio.reverse.title": "Let a multimodal model read the image and derive a reproducible prompt",
    "studio.reverse.needReference": "Upload a reference image on the left first",
    "studio.reverse.hintEmpty":
      "Deriving from an image needs a reference: switch to Image to image and upload 1–4 images on the left — no prompt required",
    "studio.reverse.hintWith":
      "Let a multimodal model study these {count} reference images and derive a prompt that reproduces them (no prompt needed)",

    /* ------------------------------------------- 增强结果（EnhanceResult: enhance） */
    "studio.enhance.resultTitle": "Enhanced result",
    "studio.enhance.appliedTag": "Applied",
    "studio.enhance.pendingTag": "Pending",
    "studio.enhance.before": "Before",
    "studio.enhance.after": "After",
    "studio.enhance.originalEmpty": "(original prompt)",
    "studio.enhance.negativeLabel": "Negative prompt",
    "studio.enhance.structuredLabel": "Breakdown",
    "studio.enhance.notesLabel": "What changed",
    "studio.enhance.apply": "Apply and replace prompt",
    "studio.enhance.applyDone": "Applied",
    "studio.enhance.discard": "Discard",
    "studio.enhance.hintPending": "Your original prompt stays untouched until you apply.",
    "studio.enhance.hintApplied": "The enhanced prompt is now in use — go ahead and generate.",

    /* ------------------------------------- 反推结果（EnhanceResult: reverse） */
    "studio.reverse.resultTitle": "Derived result",
    "studio.reverse.promptLabel": "Derived prompt",
    "studio.reverse.apply": "Apply to workbench",
    "studio.reverse.hintPending": "The workbench prompt stays untouched until you apply.",
    "studio.reverse.hintApplied": "The derived prompt is now in the workbench — go ahead and generate.",

    /* ---------------------------------------------------------- 模型选择 */
    "studio.params.model.title": "Current model",
    "studio.params.model.demo": "Demo",
    "studio.params.model.optionCount": "{count} available",
    "studio.params.model.none": "No model selected",
    "studio.params.model.switch": "Click to switch model",
    "studio.params.model.searchPlaceholder": "Search models…",
    "studio.params.model.noMatch": "No matching model",
    "studio.params.model.settingsLink": "Settings",
    "studio.params.model.settingsFoot": "Manage models and API keys",
    "studio.params.model.protocol": "OpenAI Images protocol",

    /* ---------------------------------------------------------- 风格预设 */
    "studio.params.style.title": "Style preset",
    "studio.params.style.clear": "Clear",

    /* ---------------------------------------------------------- 画幅 / 尺寸 */
    "studio.params.aspect.title": "Aspect ratio",
    "studio.params.aspect.auto": "Auto",
    "studio.params.aspect.autoHint": "The model picks the framing from your prompt — no size sent",
    "studio.params.aspect.square": "Square",
    "studio.params.aspect.landscape": "Landscape",
    "studio.params.aspect.portrait": "Portrait",
    "studio.params.aspect.wide": "Widescreen",
    "studio.params.aspect.square2k": "2K square",
    "studio.params.aspect.uhdLandscape": "4K landscape",
    "studio.params.size.auto": "Auto",
    "studio.params.size.custom": "Custom size",
    "studio.params.size.customPlaceholder": "e.g. 1792x1024",
    "studio.params.size.autoUsedHint":
      "No pixel size is sent — the model decides the framing. It is dropped entirely if the upstream rejects it.",

    /* ---------------------------------------------------------- 数量 / 画质 */
    "studio.params.count.title": "Image count",
    "studio.params.count.range": "1 – 10 images",
    "studio.params.count.suffix": "images",
    "studio.params.advanced.title": "Advanced",
    "studio.params.quality.title": "Quality",
    "studio.params.quality.auto": "Auto",
    "studio.params.quality.autoHint": "Decided by the server",
    "studio.params.quality.high": "High",
    "studio.params.quality.highHint": "Best detail, takes longer",
    "studio.params.quality.medium": "Medium",
    "studio.params.quality.mediumHint": "Balances quality and speed",
    "studio.params.quality.low": "Low",
    "studio.params.quality.lowHint": "Fast rough drafts",

    /* ---------------------------------------------------------- 种子 / 步数 */
    "studio.params.seed.label": "Seed",
    "studio.params.seed.placeholder": "Leave blank for random",
    "studio.params.seed.random": "Randomize seed",
    "studio.params.steps.label": "Steps",
    "studio.params.steps.placeholder": "Use the workflow default",

    /* ---------------------------------------------------------- 预览区 */
    "studio.preview.title": "Result",
    "studio.preview.status.idle": "Ready",
    "studio.preview.status.queued": "Queued…",
    "studio.preview.status.running": "Generating…",
    "studio.preview.status.success": "Done · {count} images",
    "studio.preview.status.failed": "Generation failed",
    "studio.preview.status.canceled": "Canceled",
    "studio.preview.empty.canvas": "The canvas is empty",
    "studio.preview.empty.hint": "Write a prompt and hit “Generate image” — results show up here",
    "studio.preview.empty.hintText2img":
      "Set parameters on the left, write your prompt on the right, then hit “Generate image”",
    "studio.preview.empty.hintImg2img":
      "Upload a reference on the left and describe the change — results show up here",
    "studio.preview.running.taskSubmitted": "Task submitted · about {count} image(s)",
    "studio.preview.running.sizeAndCount": "Size {size} · {count} images",
    "studio.preview.action.download": "Download this image",
    "studio.preview.action.reveal": "Show in file manager",
    "studio.preview.action.clear": "Clear canvas",
    "studio.preview.action.expand": "View larger",
    "studio.preview.action.prev": "Previous",
    "studio.preview.action.next": "Next",
    "studio.preview.action.reuse": "Generate another set",
    "studio.preview.promptSection": "Prompt",
    "studio.preview.copyPrompt": "Copy prompt",
    "studio.preview.editPrompt": "Edit in the prompt panel",
    "studio.preview.promptEmpty": "(no prompt)",
    "studio.preview.negativeLabel": "Negative: ",
    "studio.preview.counter": "{index} / {total}",

    /* ---------------------------------------------------------- 本地超分 */
    "studio.preview.upscale.running": "Upscaling…",
    "studio.preview.upscale.needEnable": "Turn it on in Settings · Local upscale first",
    "studio.preview.upscale.needModel": "Download a model in Settings · Local upscale first",
    "studio.preview.upscale.noLocalFile": "This image has no local file, so it cannot be upscaled",
    "studio.preview.upscale.ready": "Upscale {scale}× with {model}",
    "studio.preview.upscale.modelFallback": "local model",

    /* ---------------------------------------------------------- 底部动作 */
    "studio.action.generate": "Generate image",
    "studio.action.cancel": "Stop generating",
    "studio.action.footDemo": "Demo mode: placeholder images, so you can try the whole flow",
    "studio.action.footRunTarget": "Calls {target} · Shortcut Ctrl + Enter",
    "studio.action.footNoChannel": "No image channel yet — configure one in Settings",
    "studio.action.apply": "Apply",

    /* ---------------------------------------------------------- 参考图 */
    "studio.reference.label": "Input image",
    "studio.reference.count": "{current}/{max}",
    "studio.reference.clear": "Clear",
    "studio.reference.upload": "Click or drag an image here",
    "studio.reference.formats": "PNG / JPG / WEBP · up to {max}",
    "studio.reference.remove": "Remove",
    "studio.reference.addMore": "Add another",
    "studio.reference.hint":
      "The model repaints from this image using your prompt — a ratio close to the target size helps",

    /* ---------------------------------------------------------- 提示消息 */
    "studio.toast.promptEmpty.title": "Prompt is empty",
    "studio.toast.promptEmpty.descText2img": "Describe the scene you want first",
    "studio.toast.promptEmpty.descImg2img": "Describe how you want the original changed",
    "studio.toast.noReference.title": "No reference image",
    "studio.toast.noReference.desc": "Upload an image on the left first",
    "studio.toast.imageSaved": "Image saved",
    "studio.toast.saveFailed.title": "Save failed",
    "studio.toast.saveFailed.desc": "The image data could not be read",
    "studio.toast.promptCopied": "Prompt copied",
    "studio.toast.copyFailed.title": "Copy failed",
    "studio.toast.copyFailed.desc": "Select the text and copy it manually",
    "studio.toast.noLocalFile.title": "This image has no local file",
    "studio.toast.noLocalFile.demo": "Demo mode produces placeholders that are never written to disk",
    "studio.toast.noLocalFile.checkSetting": "Check the image saving settings",
    "studio.toast.revealDone": "Located in the file manager",
    "studio.toast.revealFailed.title": "Could not locate this image",
    "studio.toast.revealFailed.desktopOnly": "Desktop only",
    "studio.toast.upscaleDone.title": "Upscaled to {width}×{height}",
    "studio.toast.upscaleDone.desc": "Took {seconds}s · the result was appended to the canvas",
    "studio.toast.upscaleFailed.title": "Local upscale failed",
    "studio.toast.enhancing": "Calling the LLM to enhance your prompt…",
    "studio.toast.reversing": "Reading the image to derive a prompt…",
  },
);

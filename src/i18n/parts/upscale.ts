// ==========================================================================
//   本地超分词条：UpscaleView（超分页）+ components/settings/UpscalePanel
//   以及 services/upscale.ts 里面向用户的错误文案、stores/upscale.ts 的状态提示
//   —— 生图工作台侧的共用按钮见 common.ts。
//
//   分组：title（页头）/ scale（倍数与输出上限）/ backend（实际推理后端）/
//        queue（待处理队列）/ result（产物与对比）/ empty（空态）/
//        hint（耗时预期）/ action（动作）/ settings（设置面板）/
//        model（模型清单）/ gpu（GPU 加速）/ error（服务层错误）/ msg（提示消息）
//
//   ⚠️ **不要为「2× / 3× / 4×」这类倍数提供词条**：
//   按项目硬约定，超分只提供模型原生档位（见 stores/upscale.ts 的 scaleOptions 注释）。
//   给 x4 模型配一个「2×」选项是骗用户：推理照样跑满 4×，只是最后缩回去，
//   用户只会看到「一直处理中」。倍率数字由 `scaleOptions` 渲染，不进词条。
//
//   注意：模型 id、文件名、路径、尺寸数字都是**数据不是文案**。
//   本文件为它们提供的是**展示用 key**（upscale.backend.*、upscale.history.*），
//   调用方在渲染期 t() 查表，磁盘上存的仍是原始值——尤其 Rust 回报的
//   backend 字符串（"CPU" / "GPU（DirectML）"）要原样透传，不能查表改写。
//   ==========================================================================

import { definePart } from "../part";

export const upscale = definePart(
  {
    /* ---------------------------------------------------------- 页头 */
    "upscale.title": "图片超分",
    "upscale.subtitle": "在本机用 AI 把图片放大到更高分辨率 · 完全离线，不上传任何图片",
    "upscale.currentModel": "当前模型 {name}",

    /* ---------------------------------------------------------- 倍数与输出上限 */
    "upscale.scale.label": "放大倍数",
    // 原生档位说明：{name} 模型名、{scale} 该模型唯一支持的倍数
    "upscale.scale.note": "{name} · 原生 {scale}×",
    "upscale.scale.note.noModel": "尚未选择模型",

    // 输出长边上限：只影响内存/磁盘/传输，不省推理时间，提示里要说清
    "upscale.maxEdge.original": "原尺寸",
    "upscale.maxEdge.originalHint": "4× 全尺寸输出（2048² → 8192²），适合印刷",
    "upscale.maxEdge.l4096": "≤4096",
    "upscale.maxEdge.l4096Hint": "长边不超过 4096，适合屏幕查看（不省推理时间）",
    "upscale.maxEdge.l2048": "≤2048",
    "upscale.maxEdge.l2048Hint": "长边不超过 2048，体积最小（不省推理时间）",

    /* ---------------------------------------------------------- 实际推理后端 */
    // Rust 如实回报的 backend 字符串直接透传；这两个 key 只用于「还没跑过」时的占位
    "upscale.backend.cpu": "CPU",
    "upscale.backend.gpuPending": "GPU（待首次运行确认）",

    /* ---------------------------------------------------------- 待处理队列 */
    "upscale.queue.title": "待处理",
    "upscale.queue.emptyDone": "全部处理完毕",
    "upscale.queue.emptyCleared": "队列已清空",
    // 批量模式下一句话就跑完，期间拿不到逐张进度，所以只给张数不给「第 N 张」
    "upscale.running.text": "正在处理 {count} 张，请稍候",
    "upscale.running.eta": "预计还需 {time}",

    /* ---------------------------------------------------------- 产物与对比 */
    "upscale.result.title": "放大结果",
    "upscale.result.count": "{count} 张",
    "upscale.result.switchHint": "点缩略图切换",
    "upscale.result.empty": "还没有产物，选一张图点「开始超分」",
    "upscale.compare.source": "原图",
    "upscale.compare.result": "放大后",
    "upscale.compare.sourceGone": "原图已移出队列",

    /* ---------------------------------------------------------- 空态 */
    "upscale.empty.dropHint": "松手即可加入队列",
    "upscale.empty.desktopOnly.title": "本地超分仅在桌面端可用",
    "upscale.empty.desktopOnly.hint":
      "超分由内置的 ONNX 推理引擎完成，需要宿主进程参与。请在桌面应用里打开本页。",
    "upscale.empty.noModel.title": "还没有可用的超分模型",
    "upscale.empty.noModel.hint": "先到「设置 → 扩展能力 → 本地超分」下载一个模型，下载完即可完全离线使用。",
    "upscale.empty.ready.title": "把图片拖进来，或从历史记录送过来",
    "upscale.empty.ready.hint":
      "支持 PNG / JPG / WEBP，全程在本机完成、不联网。耗时取决于原图尺寸：1024×1024 约 1 分钟，2048×2048 约 3 分钟。可在下方选「输出尺寸上限」减小文件体积，有显卡可在设置页开启 GPU 加速。",
    "upscale.empty.modelLine": "当前模型 {name} ·",

    /* ---------------------------------------------------------- 耗时预期 */
    "upscale.hint.lastRun": "上次 {count} 张用时 {time}",
    "upscale.hint.firstRunUnknown":
      "首次使用需额外加载模型（1~2 秒）· {count} 张 · 1024² 约 1 分钟/张、2048² 约 3 分钟/张",
    "upscale.hint.firstRunBySize": "首次使用需额外加载模型（1~2 秒）· {count} 张 · 按当前尺寸约 {time}/张",
    "upscale.hint.minutes": "{count} 分钟",
    "upscale.hint.seconds": "{count} 秒",

    /* ---------------------------------------------------------- 动作 */
    "upscale.run.processing": "处理中…",
    "upscale.run.allDone": "全部处理完毕",
    "upscale.run.start": "开始超分",
    "upscale.run.needModel": "去下载模型",
    "upscale.run.startWithCount": "开始超分（{count} 张 · {scale}×）",
    "upscale.action.clear": "清空",
    "upscale.action.pick": "选择图片",
    "upscale.action.importing": "导入中…",
    "upscale.action.addMore": "继续添加图片",
    "upscale.action.clearQueue": "清空队列",
    "upscale.action.runOne": "立即超分这一张",
    "upscale.action.removeOne": "移出队列",
    "upscale.action.download": "下载这张",
    "upscale.action.revealFolder": "所在文件夹",
    "upscale.action.clearResults": "清空结果",
    "upscale.action.gotoModelDir": "查看模型目录",
    "upscale.action.downloadModel": "去下载模型",

    /* ---------------------------------------------------------- 设置面板 */
    "upscale.settings.panelTitle": "本地超分",
    "upscale.settings.panelDesc":
      "在本机用 AI 把生成结果放大到更高分辨率。全程离线，不上传任何图片，也不消耗生图接口的额度",
    "upscale.settings.ready": "已就绪",
    "upscale.settings.noModel": "未下载模型",
    "upscale.settings.entryLabel": "显示超分入口",
    // 关掉时必须明写「哪些地方的入口会消失」，否则用户以为开关没生效
    "upscale.settings.entryHintHiddenWithQueue":
      "侧边栏与历史记录里的超分入口已隐藏。队列中还有 {count} 张图，处理完入口就会消失",
    "upscale.settings.entryHintWillShow": "打开后侧边栏会出现「图片超分」，历史记录的图片上也会多一个快捷入口",
    "upscale.settings.entryHintNoModel": "尚未下载任何模型，下载后即可使用超分",
    "upscale.settings.entryHintActive": "当前使用 {name} · {scale} 倍放大",
    "upscale.settings.desktopOnlyDesc":
      "超分由内置的 ONNX 推理引擎完成，需要宿主进程参与。浏览器预览环境没有这一层，请在桌面应用（tauri dev / 安装包）里打开本页。",

    /* ---------------------------------------------------------- 模型清单 */
    "upscale.model.sectionTitle": "超分模型",
    "upscale.model.sectionDesc": "按需下载，存放在数据目录的 models/ 下；删除后不影响已生成的图片",
    "upscale.model.listLoading": "正在读取模型列表…",
    "upscale.model.installed": "已下载",
    "upscale.model.inUse": "使用中",
    "upscale.model.download": "下载",
    "upscale.model.downloading": "下载中…",
    "upscale.model.select": "选用",
    "upscale.model.selected": "已选用",
    "upscale.model.remove": "删除模型文件",
    "upscale.model.footNote":
      "放大在 CPU 上完成，1024×1024 的图约需数秒到十几秒。超分产物是独立的新图，会追加到结果区供你与原图对比，不会覆盖原图。",

    /* ---------------------------------------------------------- GPU 加速 */
    "upscale.gpu.title": "GPU 加速",
    "upscale.gpu.desc":
      "用显卡（DirectX 12）跑推理，NVIDIA / AMD / Intel 都支持。实测在 RTX 3060 Ti 上约快 1.2 倍——不是质变，所以默认关闭；开启后若 GPU 不可用会自动回退 CPU，超分不会因此变得不可用",
    "upscale.gpu.detect": "检测 GPU",
    "upscale.gpu.probing": "检测中…",
    "upscale.gpu.available": "GPU 可用",
    "upscale.gpu.unavailable": "GPU 不可用",
    "upscale.gpu.switchLabel": "启用 GPU 加速",
    "upscale.gpu.hintNeedModel": "需要先下载模型才能检测",
    "upscale.gpu.hintNotProbed": "尚未检测。点击右上角「检测 GPU」确认本机是否可用",
    "upscale.gpu.hintFailed": "本机未通过检测，开启请求已自动关闭",
    "upscale.gpu.hintOn": "已开启 · 失败时自动回退 CPU（会稍慢，但不会中断）",
    "upscale.gpu.hintOff": "已检测可用，当前未开启",

    /* ---------------------------------------------------------- 服务层错误 */
    "upscale.error.notDesktop": "本地超分仅在桌面端可用，浏览器预览下无法运行 ONNX 推理",
    "upscale.error.noLocalFileOne": "该图片没有本地文件，无法超分",
    "upscale.error.noLocalFileMany": "所选图片都没有本地文件，无法超分",
    "upscale.error.dataDir": "无法定位应用数据目录",

    /* ---------------------------------------------------------- 提示消息 */
    "upscale.msg.noModel.title": "尚未下载超分模型",
    "upscale.msg.noModel.desc": "本地超分需要先下载一个模型（约 17MB，下载后完全离线）",
    "upscale.msg.unsupportedFormat.title": "格式不支持",
    "upscale.msg.unsupportedFormat.pick": "请选择 PNG / JPG / WEBP 图片",
    "upscale.msg.unsupportedFormat.drop": "请拖入 PNG / JPG / WEBP 图片",
    "upscale.msg.nothingToAdd": "没有可加入的图片",
    "upscale.msg.nothingToAdd.desc": "所选图片没有本地文件，或已经在队列里",
    "upscale.msg.added": "已加入 {count} 张",
    "upscale.msg.importFailed": "导入图片失败",
    "upscale.msg.failed.title": "超分失败",
    "upscale.msg.batchFailed.title": "批量超分失败",
    "upscale.msg.noUsableModel.title": "没有可用模型",
    "upscale.msg.noUsableModel.desc": "请先到设置页下载并选用一个超分模型",
    "upscale.msg.queueNoLocal.title": "队列里没有可处理的图片",
    "upscale.msg.queueNoLocal.desc": "仅本地落盘的图片能超分",
    "upscale.msg.done.title": "已放大 {count} 张",
    "upscale.msg.done.partial": "其中 {failed} 张失败 · 平均每张 {seconds} 秒",
    "upscale.msg.done.ok": "{scale}× · 平均每张 {seconds} 秒 · 已登记进历史记录",
    "upscale.msg.allFailed.title": "全部图片都超分失败",
    "upscale.msg.allFailed.desc": "请检查图片格式与模型状态",
    "upscale.msg.noLocalFile": "该图片没有本地文件",
    "upscale.msg.revealed": "已在文件管理器中定位",
    "upscale.msg.revealFailed.title": "没能定位到这张图",
    "upscale.msg.revealFailed.desc": "仅桌面端可用",
    "upscale.msg.saved": "已保存图片",
    "upscale.msg.saveFailed.title": "保存失败",
    "upscale.msg.saveFailed.desc": "无法读取图片内容",
    "upscale.msg.modelDirOpened": "已打开模型目录",
    "upscale.msg.modelDirFailed": "没能打开模型目录",
    "upscale.msg.downloaded.title": "{name} 已下载",
    "upscale.msg.downloaded.desc": "之后完全离线可用，超分不再消耗流量",
    "upscale.msg.downloadFailed": "模型下载失败",
    "upscale.msg.removed.desc": "需要时可以重新下载",
    "upscale.msg.removeFailed": "删除模型失败",

    /* ---------------------------------------------------------- 历史记录登记 */
    // 下面两个是**写进历史记录的默认数据**：磁盘上存的仍是「超分」「本地超分」，
    // 渲染期按 key 查表显示。这样切到英文时老记录也跟着变，
    // 又不会把已落盘的数据改写成英文（`t()` 而不是 `t()` 后写回）。
    "upscale.history.tag": "超分",
    "upscale.history.modelFallback": "本地超分",
  },
  {
    /* ---------------------------------------------------------- 页头 */
    "upscale.title": "Upscale",
    "upscale.subtitle": "Enlarge images with on-device AI · fully offline, nothing is uploaded",
    "upscale.currentModel": "Current model: {name}",

    /* ---------------------------------------------------------- 倍数与输出上限 */
    "upscale.scale.label": "Scale",
    // 原生档位说明：{name} 模型名、{scale} 该模型唯一支持的倍数
    "upscale.scale.note": "{name} · native {scale}×",
    "upscale.scale.note.noModel": "No model selected",

    // 输出长边上限：只影响内存/磁盘/传输，不省推理时间，提示里要说清
    "upscale.maxEdge.original": "Original",
    "upscale.maxEdge.originalHint": "Full 4× output (2048² → 8192²), suited for print",
    "upscale.maxEdge.l4096": "≤4096",
    "upscale.maxEdge.l4096Hint": "Longest edge capped at 4096 — better for on-screen use (does not save inference time)",
    "upscale.maxEdge.l2048": "≤2048",
    "upscale.maxEdge.l2048Hint": "Longest edge capped at 2048 — smallest files (does not save inference time)",

    /* ---------------------------------------------------------- 实际推理后端 */
    // Rust 如实回报的 backend 字符串直接透传；这两个 key 只用于「还没跑过」时的占位
    "upscale.backend.cpu": "CPU",
    "upscale.backend.gpuPending": "GPU (confirmed on first run)",

    /* ---------------------------------------------------------- 待处理队列 */
    "upscale.queue.title": "Queued",
    "upscale.queue.emptyDone": "Everything is processed",
    "upscale.queue.emptyCleared": "Queue cleared",
    // 批量模式下一句话就跑完，期间拿不到逐张进度，所以只给张数不给「item N of M」
    "upscale.running.text": "Processing {count} images, please wait",
    "upscale.running.eta": "About {time} left",

    /* ---------------------------------------------------------- 产物与对比 */
    "upscale.result.title": "Upscaled results",
    "upscale.result.count": "{count} images",
    "upscale.result.switchHint": "Click a thumbnail to switch",
    "upscale.result.empty": "No results yet — pick an image and hit “Start upscaling”",
    "upscale.compare.source": "Original",
    "upscale.compare.result": "Upscaled",
    "upscale.compare.sourceGone": "Original is no longer in the queue",

    /* ---------------------------------------------------------- 空态 */
    "upscale.empty.dropHint": "Drop to add to the queue",
    "upscale.empty.desktopOnly.title": "Local upscaling is desktop-only",
    "upscale.empty.desktopOnly.hint":
      "Upscaling runs on the built-in ONNX engine and needs the host process. Open this page in the desktop app.",
    "upscale.empty.noModel.title": "No upscale model available yet",
    "upscale.empty.noModel.hint":
      "Download a model in Settings · Extensions · Local upscale — once downloaded it works fully offline.",
    "upscale.empty.ready.title": "Drop images here, or send them over from History",
    "upscale.empty.ready.hint":
      "PNG / JPG / WEBP, processed entirely on this machine with no network access. Time depends on the source size: 1024×1024 takes about 1 minute, 2048×2048 about 3 minutes. Pick an output size limit below to shrink files, or turn on GPU acceleration in Settings if your machine has a suitable GPU.",
    "upscale.empty.modelLine": "Current model: {name} ·",

    /* ---------------------------------------------------------- 耗时预期 */
    "upscale.hint.lastRun": "Last run: {count} images took {time}",
    "upscale.hint.firstRunUnknown":
      "First run also loads the model (1–2 s) · {count} images · about 1 min per 1024² image, 3 min per 2048²",
    "upscale.hint.firstRunBySize":
      "First run also loads the model (1–2 s) · {count} images · roughly {time} each at the current size",
    "upscale.hint.minutes": "{count} min",
    "upscale.hint.seconds": "{count} s",

    /* ---------------------------------------------------------- 动作 */
    "upscale.run.processing": "Processing…",
    "upscale.run.allDone": "Everything is processed",
    "upscale.run.start": "Start upscaling",
    "upscale.run.needModel": "Download a model",
    "upscale.run.startWithCount": "Start upscaling ({count} images · {scale}×)",
    "upscale.action.clear": "Clear",
    "upscale.action.pick": "Select images",
    "upscale.action.importing": "Importing…",
    "upscale.action.addMore": "Add more images",
    "upscale.action.clearQueue": "Clear queue",
    "upscale.action.runOne": "Upscale this one now",
    "upscale.action.removeOne": "Remove from queue",
    "upscale.action.download": "Download this one",
    "upscale.action.revealFolder": "Show in folder",
    "upscale.action.clearResults": "Clear results",
    "upscale.action.gotoModelDir": "Show model folder",
    "upscale.action.downloadModel": "Download a model",

    /* ---------------------------------------------------------- 设置面板 */
    "upscale.settings.panelTitle": "Local upscale",
    "upscale.settings.panelDesc":
      "Enlarge generated images with on-device AI. Runs fully offline, uploads nothing, and uses no generation credits",
    "upscale.settings.ready": "Ready",
    "upscale.settings.noModel": "No model",
    "upscale.settings.entryLabel": "Show upscale entry points",
    // 关掉时必须明写「哪些地方的入口会消失」，否则用户以为开关没生效
    "upscale.settings.entryHintHiddenWithQueue":
      "The upscale entry in the sidebar and in History is now hidden. {count} images are still queued — the entry disappears once they are done",
    "upscale.settings.entryHintWillShow":
      "When on, “Upscale” appears in the sidebar and each image in History gains a shortcut",
    "upscale.settings.entryHintNoModel": "No model downloaded yet — download one to start upscaling",
    "upscale.settings.entryHintActive": "Currently using {name} · {scale}× upscale",
    "upscale.settings.desktopOnlyDesc":
      "Upscaling runs on the built-in ONNX engine and needs the host process. The browser preview has no such layer, so open this page in the desktop app (tauri dev / installed build).",

    /* ---------------------------------------------------------- 模型清单 */
    "upscale.model.sectionTitle": "Upscale models",
    "upscale.model.sectionDesc":
      "Download on demand into models/ under the data folder — deleting one never affects images you already made",
    "upscale.model.listLoading": "Reading the model list…",
    "upscale.model.installed": "Downloaded",
    "upscale.model.inUse": "In use",
    "upscale.model.download": "Download",
    "upscale.model.downloading": "Downloading…",
    "upscale.model.select": "Use",
    "upscale.model.selected": "Selected",
    "upscale.model.remove": "Delete model file",
    "upscale.model.footNote":
      "Upscaling runs on the CPU — a 1024×1024 image takes seconds to a little under a minute. Each result is a brand-new image: it is appended to the results panel so you can compare it against the original, and the original is never overwritten.",

    /* ---------------------------------------------------------- GPU 加速 */
    "upscale.gpu.title": "GPU acceleration",
    "upscale.gpu.desc":
      "Runs inference on your GPU through DirectX 12 — NVIDIA, AMD and Intel all work. Measured at roughly 1.2× faster on an RTX 3060 Ti, which is not a step change, so it is off by default; if the GPU turns out to be unavailable, upscaling falls back to CPU automatically and stays usable",
    "upscale.gpu.detect": "Detect GPU",
    "upscale.gpu.probing": "Detecting…",
    "upscale.gpu.available": "GPU available",
    "upscale.gpu.unavailable": "GPU unavailable",
    "upscale.gpu.switchLabel": "Enable GPU acceleration",
    "upscale.gpu.hintNeedModel": "Download a model first — detection needs one",
    "upscale.gpu.hintNotProbed": "Not tested yet. Hit “Detect GPU” at the top right to check this machine",
    "upscale.gpu.hintFailed": "This machine did not pass the check, so the request was turned off automatically",
    "upscale.gpu.hintOn": "On · falls back to CPU on failure (slower, but never interrupted)",
    "upscale.gpu.hintOff": "Detected as available, currently off",

    /* ---------------------------------------------------------- 服务层错误 */
    "upscale.error.notDesktop":
      "Local upscaling is desktop-only — ONNX inference cannot run in the browser preview",
    "upscale.error.noLocalFileOne": "This image has no local file, so it cannot be upscaled",
    "upscale.error.noLocalFileMany": "None of the selected images have a local file, so none can be upscaled",
    "upscale.error.dataDir": "Could not locate the app data folder",

    /* ---------------------------------------------------------- 提示消息 */
    "upscale.msg.noModel.title": "No upscale model yet",
    "upscale.msg.noModel.desc": "Local upscaling needs a model first (about 17 MB, fully offline once downloaded)",
    "upscale.msg.unsupportedFormat.title": "Unsupported format",
    "upscale.msg.unsupportedFormat.pick": "Choose PNG / JPG / WEBP images",
    "upscale.msg.unsupportedFormat.drop": "Drop PNG / JPG / WEBP images",
    "upscale.msg.nothingToAdd": "Nothing to add",
    "upscale.msg.nothingToAdd.desc": "The selection has no local files, or is already in the queue",
    "upscale.msg.added": "Added {count} images",
    "upscale.msg.importFailed": "Import failed",
    "upscale.msg.failed.title": "Upscaling failed",
    "upscale.msg.batchFailed.title": "Batch upscaling failed",
    "upscale.msg.noUsableModel.title": "No usable model",
    "upscale.msg.noUsableModel.desc": "Download and select an upscale model in Settings first",
    "upscale.msg.queueNoLocal.title": "No processable images in the queue",
    "upscale.msg.queueNoLocal.desc": "Only images saved to disk can be upscaled",
    "upscale.msg.done.title": "Upscaled {count} images",
    "upscale.msg.done.partial": "{failed} failed · {seconds} s each on average",
    "upscale.msg.done.ok": "{scale}× · {seconds} s each on average · added to History",
    "upscale.msg.allFailed.title": "Every image failed to upscale",
    "upscale.msg.allFailed.desc": "Check the image formats and the model status",
    "upscale.msg.noLocalFile": "This image has no local file",
    "upscale.msg.revealed": "Revealed in the file manager",
    "upscale.msg.revealFailed.title": "Could not locate this image",
    "upscale.msg.revealFailed.desc": "Desktop only",
    "upscale.msg.saved": "Image saved",
    "upscale.msg.saveFailed.title": "Save failed",
    "upscale.msg.saveFailed.desc": "The image data could not be read",
    "upscale.msg.modelDirOpened": "Opened the model folder",
    "upscale.msg.modelDirFailed": "Could not open the model folder",
    "upscale.msg.downloaded.title": "{name} downloaded",
    "upscale.msg.downloaded.desc": "It works fully offline from now on — no more data use",
    "upscale.msg.downloadFailed": "Model download failed",
    "upscale.msg.removed.desc": "You can download it again whenever you need it",
    "upscale.msg.removeFailed": "Could not delete the model",

    /* ---------------------------------------------------------- 历史记录登记 */
    // 下面两个是**写进历史记录的默认数据**：磁盘上存的仍是「超分」「本地超分」，
    // 渲染期按 key 查表显示。这样切到英文时老记录也跟着变，
    // 又不会把已落盘的数据改写成英文（`t()` 而不是 `t()` 后写回）。
    "upscale.history.tag": "Upscaled",
    "upscale.history.modelFallback": "Local upscale",
  },
);
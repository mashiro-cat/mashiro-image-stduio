// ==========================================================================
//   历史记录与相册词条：HistoryView（历史页）+ components/history/AlbumRail
//   以及 stores/history.ts、stores/collections.ts 里用户可见的提示文案
//   —— 生成详情里复用的工作台提示词面板见 studio.ts。
//
//   分组：title（页头）/ stats（顶部统计）/ filter（筛选与标签）/
//        batch（批量工具条）/ album（相册栏与相册弹层）/ tag（标签弹层）/
//        detail（生成详情）/ reverse（详情里的提示词反推）/ action（动作）/
//        empty（空态）/ confirm（危险操作确认框）/ msg（提示消息）
//
//   注意：GenMode（text2img/img2img/workflow）与任务状态
//   （idle/queued/running/success/failed/canceled）都是**数据不是文案**。
//   本文件为它们提供的是**展示用 key**（history.mode.*、history.status.*），
//   调用方在渲染期 t() 查表，磁盘上存的仍是原始枚举值——MODE_LABEL 目前是
//   常量表，接入时要把「查表」放在渲染处，别把译名写回记录。
//   ==========================================================================

import { definePart } from "../part";

export const history = definePart(
  {
    /* ---------------------------------------------------------- 页头 */
    "history.title": "历史记录",
    "history.stats": "共 {total} 次生成 · {images} 张图片 · 成功率 {rate}%",

    /* ---------------------------------------------------------- 模式与状态展示 */
    // GenMode 枚举的展示名
    "history.mode.text2img": "文生图",
    "history.mode.img2img": "图生图",
    "history.mode.workflow": "工作流",

    // 任务状态枚举的展示名（卡片角标、详情与筛选共用同一套）
    "history.status.success": "成功",
    "history.status.failed": "失败",
    "history.status.running": "进行中",
    "history.status.canceled": "已取消",

    /* ---------------------------------------------------------- 筛选 */
    "history.filter.searchPlaceholder": "搜索提示词、模型或工作流…",
    "history.filter.mode.all": "全部",
    "history.filter.status.all": "全部状态",
    "history.filter.onlyFavorite": "仅收藏",
    "history.filter.tagsLabel": "标签",
    "history.filter.count": "共 {count} 条",
    "history.filter.dayCount": "{count} 条",
    "history.filter.collapseTags": "收起",
    "history.filter.selectedCount": "已选 {selected} / {total} 条",

    /* ---------------------------------------------------------- 批量工具条 */
    "history.batch.enter": "批量管理",
    "history.batch.exit": "退出批量",
    "history.batch.selectAll": "全选当前结果",
    "history.batch.deselectAll": "取消全选",
    "history.batch.addToAlbum": "加入相册",
    "history.batch.addTag": "加标签",

    /* ---------------------------------------------------------- 相册栏 */
    "history.album.title": "相册",
    "history.album.all": "全部记录",
    "history.album.unsorted": "未归档",
    "history.album.create": "新建相册",
    "history.album.rename": "重命名",
    "history.album.remove": "删除相册",
    "history.album.namePlaceholder": "相册名称，回车创建",
    "history.album.emptyHint": "还没有相册。建一个把同系列的作品归到一起。",
    "history.album.defaultName": "未命名相册",
    "history.album.autoName": "相册 {index}",

    /* ---------------------------------------------------------- 相册弹层 */
    "history.album.pickTitle": "把选中的记录归入相册",
    "history.album.pickDesc": "共选中 {count} 条记录",
    "history.album.pickUnassigned": "移出相册（未归档）",
    "history.album.pickHint": "没有想要的相册？可以在左侧相册栏点「+」新建一个。",
    "history.album.pickConfirm": "确认归入",

    /* ---------------------------------------------------------- 标签弹层 */
    "history.tag.pickTitle": "给选中的记录加标签",
    "history.tag.pickDesc": "共选中 {count} 条记录",
    "history.tag.placeholder": "例如：客户 A / 系列一 / 待精修",
    "history.tag.hint": "已有标签可直接点选；重复标签不会重复添加",
    "history.tag.add": "添加标签",

    /* ---------------------------------------------------------- 生成详情 */
    "history.detail.title": "生成详情",
    "history.detail.titleWithMode": "{mode} · 生成详情",
    "history.detail.promptLabel": "提示词",
    "history.detail.promptEmpty": "（无）",
    "history.detail.negativeLabel": "负向：",
    "history.detail.noPromptOnCard": "（无提示词）",
    "history.detail.structured": "结构化拆解",
    "history.detail.organize": "整理",
    "history.detail.albumLabel": "相册",
    "history.detail.tagLabel": "标签",
    "history.detail.tagPlaceholder": "输入后回车添加标签",
    "history.detail.paramsLabel": "生成参数",
    "history.detail.durationLabel": "耗时",
    "history.detail.taskIdLabel": "任务 ID",
    "history.detail.workflowLabel": "工作流",
    "history.detail.failReason": "失败原因",
    "history.detail.noImages": "该记录没有图片",
    "history.detail.failedNoImages": "本次生成未产出图片",
    "history.detail.viewLarge": "查看大图",
    "history.detail.clickToEnlarge": "点击查看大图",

    /* ---------------------------------------------------------- 提示词反推 */
    // 反推结果面板（EnhanceResult 的 reverse 变体）复用 studio.reverse.*，
    // 这里只放历史详情这一侧的区块标题、按钮与两种空态说明。
    "history.reverse.sectionTitle": "提示词反推",
    "history.reverse.run": "反推提示词",
    "history.reverse.running": "正在反推…",
    "history.reverse.hintWithImages":
      "让多模态模型观察这次的生成结果，倒推出一条能复现它的提示词；采纳后填入工作台",
    "history.reverse.hintNoImages": "这条记录没有图片，将按生成参数复盘出一条可复用的提示词",

    /* ---------------------------------------------------------- 动作 */
    "history.action.reuse": "复用参数",
    "history.action.favorite": "收藏",
    "history.action.clearFailed": "清理失败记录",
    "history.action.clearAll": "清空全部",
    "history.action.resetFilters": "重置筛选",
    "history.action.startText2img": "开始文生图",
    "history.action.sendToUpscale": "把这张送去超分",
    "history.action.sendToUpscaleShort": "送去超分",
    "history.action.upscaleShort": "超分",
    "history.action.reveal": "在文件管理器中显示",
    "history.action.openFolder": "打开所在文件夹",
    "history.action.locateShort": "定位",
    "history.action.saveToLibrary": "存入提示词库",

    /* ---------------------------------------------------------- 空态 */
    "history.empty.title": "没有找到匹配的记录",
    "history.empty.desc": "调整筛选条件，或去工作台开始新的创作",

    /* ---------------------------------------------------------- 危险操作确认 */
    "history.confirm.deleteOne.title": "删除这条记录？",
    "history.confirm.deleteOne.desc": "本地已落盘的图片文件会一并删除，操作不可恢复。",
    "history.confirm.deleteOne.action": "删除",
    "history.confirm.deleteMany.title": "删除选中的 {count} 条记录？",
    "history.confirm.deleteMany.desc":
      "这些记录已落盘的图片会一并删除；仍被其它记录或工作台草稿引用的图片会自动保留。",
    "history.confirm.deleteMany.action": "删除 {count} 条",
    "history.confirm.clearAll.title": "清空全部历史记录？",
    "history.confirm.clearAll.desc": "将删除 {count} 条记录及其本地图片文件，操作不可恢复。",
    "history.confirm.clearAll.action": "全部清空",
    "history.confirm.clearFailed.title": "清理失败记录？",
    "history.confirm.clearFailed.desc": "仅删除状态为「失败」的记录，成功记录会保留。",
    "history.confirm.clearFailed.action": "清理",
    "history.confirm.deleteAlbum.title": "删除相册「{name}」？",
    "history.confirm.deleteAlbum.withCount":
      "相册里的 {count} 条记录会保留，只是不再归档到这个相册（会落到「未归档」）。",
    "history.confirm.deleteAlbum.empty": "该相册当前没有记录。",
    "history.confirm.deleteAlbum.action": "删除相册",

    /* ---------------------------------------------------------- 提示消息 */
    "history.msg.reuseLoaded": "已载入该次参数",
    "history.msg.reuseLoaded.desc": "可在工作台继续调整后重新生成",
    "history.msg.savedToLibrary": "已存入提示词库",
    "history.msg.savedToLibrary.desc": "「{title}」",
    "history.msg.promptCopied": "提示词已复制",
    "history.msg.copyFailed": "复制失败",
    "history.msg.notSaved.title": "该图片未保存在本地",
    "history.msg.notSaved.desc": "可在设置页检查图片落盘设置",
    "history.msg.notSavedUpscaleDesc": "本地超分需要读取磁盘上的文件",
    "history.msg.revealed": "已在文件管理器中定位",
    "history.msg.revealFailed.title": "没能定位到这张图",
    "history.msg.revealFailed.desc": "仅桌面端可用",
    "history.msg.noImagesInRecord": "该记录没有图片",
    "history.msg.imageSaved": "已保存图片",
    "history.msg.saveFailed.title": "保存失败",
    "history.msg.saveFailed.desc": "无法读取图片内容（远端链接可能已过期）",
    "history.msg.albumCreated": "已创建相册",
    "history.msg.albumRenamed": "已重命名相册",
    "history.msg.nameDetail": "「{name}」",
    "history.msg.assigned.desc": "共 {count} 条记录",
    "history.msg.tagAdded": "已添加标签「{tag}」",
    "history.msg.deleted": "已删除记录",
    "history.msg.deletedCount": "{count} 条",
    "history.msg.recordsDeleted": "已删除记录",
    "history.msg.clearedAll": "历史记录已清空",
    "history.msg.cleared": "已清理",
    "history.msg.clearedFailedCount": "删除 {count} 条失败记录",
  },
  {
    /* ---------------------------------------------------------- 页头 */
    "history.title": "History",
    "history.stats": "{total} generations · {images} images · {rate}% success rate",

    /* ---------------------------------------------------------- 模式与状态展示 */
    // GenMode 枚举的展示名
    "history.mode.text2img": "Text to image",
    "history.mode.img2img": "Image to image",
    "history.mode.workflow": "Workflow",

    // 任务状态枚举的展示名（卡片角标、详情与筛选共用同一套）
    "history.status.success": "Succeeded",
    "history.status.failed": "Failed",
    "history.status.running": "In progress",
    "history.status.canceled": "Canceled",

    /* ---------------------------------------------------------- 筛选 */
    "history.filter.searchPlaceholder": "Search prompts, models or workflows…",
    "history.filter.mode.all": "All",
    "history.filter.status.all": "Any status",
    "history.filter.onlyFavorite": "Favorites only",
    "history.filter.tagsLabel": "Tags",
    "history.filter.count": "{count} items",
    "history.filter.dayCount": "{count} items",
    "history.filter.collapseTags": "Collapse",
    "history.filter.selectedCount": "{selected} of {total} selected",

    /* ---------------------------------------------------------- 批量工具条 */
    "history.batch.enter": "Batch edit",
    "history.batch.exit": "Exit batch mode",
    "history.batch.selectAll": "Select all shown",
    "history.batch.deselectAll": "Clear selection",
    "history.batch.addToAlbum": "Add to album",
    "history.batch.addTag": "Add tags",

    /* ---------------------------------------------------------- 相册栏 */
    "history.album.title": "Albums",
    "history.album.all": "All records",
    "history.album.unsorted": "Unfiled",
    "history.album.create": "New album",
    "history.album.rename": "Rename",
    "history.album.remove": "Delete album",
    "history.album.namePlaceholder": "Album name, press Enter to create",
    "history.album.emptyHint": "No albums yet. Create one to group a series of related works.",
    "history.album.defaultName": "Untitled album",
    "history.album.autoName": "Album {index}",

    /* ---------------------------------------------------------- 相册弹层 */
    "history.album.pickTitle": "Move the selected records into an album",
    "history.album.pickDesc": "{count} records selected",
    "history.album.pickUnassigned": "Remove from album (Unfiled)",
    "history.album.pickHint": "Don't see the album you want? Create one with “+” in the sidebar.",
    "history.album.pickConfirm": "Move to album",

    /* ---------------------------------------------------------- 标签弹层 */
    "history.tag.pickTitle": "Tag the selected records",
    "history.tag.pickDesc": "{count} records selected",
    "history.tag.placeholder": "For example: Client A / Series 1 / Needs retouch",
    "history.tag.hint": "Click an existing tag to reuse it — duplicates are skipped",
    "history.tag.add": "Add tags",

    /* ---------------------------------------------------------- 生成详情 */
    "history.detail.title": "Generation details",
    "history.detail.titleWithMode": "{mode} · Generation details",
    "history.detail.promptLabel": "Prompt",
    "history.detail.promptEmpty": "(none)",
    "history.detail.negativeLabel": "Negative: ",
    "history.detail.noPromptOnCard": "(no prompt)",
    "history.detail.structured": "Breakdown",
    "history.detail.organize": "Organize",
    "history.detail.albumLabel": "Album",
    "history.detail.tagLabel": "Tags",
    "history.detail.tagPlaceholder": "Type and press Enter to add a tag",
    "history.detail.paramsLabel": "Generation parameters",
    "history.detail.durationLabel": "Duration",
    "history.detail.taskIdLabel": "Task ID",
    "history.detail.workflowLabel": "Workflow",
    "history.detail.failReason": "Failure reason",
    "history.detail.noImages": "This record has no images",
    "history.detail.failedNoImages": "This run produced no images",
    "history.detail.viewLarge": "View full size",
    "history.detail.clickToEnlarge": "Click to view full size",

    /* ---------------------------------------------------------- 提示词反推 */
    // 反推结果面板（EnhanceResult 的 reverse 变体）复用 studio.reverse.*，
    // 这里只放历史详情这一侧的区块标题、按钮与两种空态说明。
    "history.reverse.sectionTitle": "Derive prompt",
    "history.reverse.run": "Derive prompt",
    "history.reverse.running": "Deriving…",
    "history.reverse.hintWithImages":
      "Let a multimodal model study this result and work out a prompt that reproduces it — apply it to send it to the workbench",
    "history.reverse.hintNoImages":
      "This record has no images, so a reusable prompt will be reconstructed from the generation parameters",

    /* ---------------------------------------------------------- 动作 */
    "history.action.reuse": "Reuse parameters",
    "history.action.favorite": "Favorite",
    "history.action.clearFailed": "Clear failed",
    "history.action.clearAll": "Clear all",
    "history.action.resetFilters": "Reset filters",
    "history.action.startText2img": "Start text to image",
    "history.action.sendToUpscale": "Upscale this image",
    "history.action.sendToUpscaleShort": "Send to upscale",
    "history.action.upscaleShort": "Upscale",
    "history.action.reveal": "Show in file manager",
    "history.action.openFolder": "Open containing folder",
    "history.action.locateShort": "Locate",
    "history.action.saveToLibrary": "Save to prompt library",

    /* ---------------------------------------------------------- 空态 */
    "history.empty.title": "No matching records",
    "history.empty.desc": "Adjust the filters, or head to the workbench and start something new",

    /* ---------------------------------------------------------- 危险操作确认 */
    "history.confirm.deleteOne.title": "Delete this record?",
    "history.confirm.deleteOne.desc":
      "Image files already saved to disk are deleted too, and this cannot be undone.",
    "history.confirm.deleteOne.action": "Delete",
    "history.confirm.deleteMany.title": "Delete the {count} selected records?",
    "history.confirm.deleteMany.desc":
      "Images already saved to disk are deleted too; anything still referenced by another record or by a workbench draft is kept.",
    "history.confirm.deleteMany.action": "Delete {count}",
    "history.confirm.clearAll.title": "Clear the entire history?",
    "history.confirm.clearAll.desc":
      "This deletes {count} records and their local image files, and cannot be undone.",
    "history.confirm.clearAll.action": "Clear everything",
    "history.confirm.clearFailed.title": "Clear failed records?",
    "history.confirm.clearFailed.desc": "Only records marked “Failed” are deleted — successful ones are kept.",
    "history.confirm.clearFailed.action": "Clear",
    "history.confirm.deleteAlbum.title": "Delete the album “{name}”?",
    "history.confirm.deleteAlbum.withCount":
      "The {count} records in it are kept — they just stop being filed under this album and fall back to “Unfiled”.",
    "history.confirm.deleteAlbum.empty": "This album has no records.",
    "history.confirm.deleteAlbum.action": "Delete album",

    /* ---------------------------------------------------------- 提示消息 */
    "history.msg.reuseLoaded": "Parameters loaded",
    "history.msg.reuseLoaded.desc": "Adjust them in the workbench and generate again",
    "history.msg.savedToLibrary": "Saved to the prompt library",
    "history.msg.savedToLibrary.desc": "“{title}”",
    "history.msg.promptCopied": "Prompt copied",
    "history.msg.copyFailed": "Copy failed",
    "history.msg.notSaved.title": "This image is not saved locally",
    "history.msg.notSaved.desc": "Check the image storage settings",
    "history.msg.notSavedUpscaleDesc": "Local upscaling has to read the file from disk",
    "history.msg.revealed": "Revealed in the file manager",
    "history.msg.revealFailed.title": "Could not locate this image",
    "history.msg.revealFailed.desc": "Desktop only",
    "history.msg.noImagesInRecord": "This record has no images",
    "history.msg.imageSaved": "Image saved",
    "history.msg.saveFailed.title": "Save failed",
    "history.msg.saveFailed.desc": "The image data could not be read (the remote link may have expired)",
    "history.msg.albumCreated": "Album created",
    "history.msg.albumRenamed": "Album renamed",
    "history.msg.nameDetail": "“{name}”",
    "history.msg.assigned.desc": "{count} records",
    "history.msg.tagAdded": "Added the tag “{tag}”",
    "history.msg.deleted": "Record deleted",
    "history.msg.deletedCount": "{count} records",
    "history.msg.recordsDeleted": "Records deleted",
    "history.msg.clearedAll": "History cleared",
    "history.msg.cleared": "Cleared",
    "history.msg.clearedFailedCount": "Removed {count} failed records",
  },
);
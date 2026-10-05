// ==========================================================================
//   提示词库词条：PromptLibraryView（提示词库页）+ components/prompt 下的
//   PromptEditorModal、PromptPreviewModal、PromptRepoModal、RemoteImage，
//   以及 stores/prompts.ts / stores/promptRepos.ts 里用户可见的提示文案
//   —— 通用按钮见 common.ts。
//
//   分组：title（页头）/ source（来源展示与筛选）/ category（分类）/
//        filter（筛选与排序）/ card（卡片）/ pager（分页）/ editor（编辑弹层）/
//        preview（案例详情）/ repo（仓库拉取）/ action（动作）/ empty（空态）/
//        confirm（确认框）/ msg（提示消息）/ default（默认数据展示）
//
//   ⚠️ `source` 枚举 manual / enhanced / builtin / history / repo 是**数据**：
//   它会被写进 PromptItem 并持久化，筛选逻辑（sourceKind === "repo"）也依赖它。
//   本文件只提供**展示用 key**（prompts.source.*），调用方在渲染期 t() 查表——
//   绝不能把译名写回 items，否则重启后筛选会全部失配、来源标签再也匹配不上。
//   同样不翻译的还有：仓库 id（owner/name）、来源链接、作者名、文件路径。
//
//   ⚠️ 分类名（PROMPT_CATEGORIES）同样是数据：它们存在 PromptItem.category 里，
//   改译名会让老条目落到一个不存在的分类下。展示走 prompts.category.*。
//   ==========================================================================

import { definePart } from "../part";

export const prompts = definePart(
  {
    /* ---------------------------------------------------------- 页头 */
    "prompts.title": "提示词库",
    "prompts.stats": "共 {count} 条提示词 · 累计使用 {usage} 次",
    "prompts.statsRepo": "其中仓库案例 {count} 条",
    "prompts.statsLlmReady": "已接入 LLM，可一键智能增强",
    "prompts.statsLlmMissing": "配置 LLM Key 后可智能增强",

    /* ---------------------------------------------------------- 来源 */
    // source 枚举（manual/enhanced/builtin/history/repo）的展示名
    "prompts.source.builtin": "内置",
    "prompts.source.manual": "我的",
    "prompts.source.enhanced": "AI 增强",
    "prompts.source.history": "来自历史",
    "prompts.source.repo": "仓库",
    // 来源筛选按钮（含「不限」）
    "prompts.source.filterAll": "全部",
    "prompts.source.filterBuiltin": "内置",
    "prompts.source.filterMine": "我的",

    /* ---------------------------------------------------------- 分类 */
    // PROMPT_CATEGORIES 的展示名，顺序与 stores/prompts.ts 保持一致
    "prompts.category.portrait": "人像",
    "prompts.category.scene": "场景",
    "prompts.category.product": "产品",
    "prompts.category.ecommerce": "电商",
    "prompts.category.advertising": "广告",
    "prompts.category.poster": "海报",
    "prompts.category.illustration": "插画",
    "prompts.category.character": "角色",
    "prompts.category.ui": "UI",
    "prompts.category.architecture": "建筑",
    "prompts.category.concept": "概念",
    "prompts.category.community": "社区",
    "prompts.category.other": "其他",

    /* ---------------------------------------------------------- 筛选与排序 */
    "prompts.filter.searchPlaceholder": "搜索标题、内容或标签…",
    "prompts.filter.favorite": "收藏",
    "prompts.filter.allCategories": "全部分类",
    "prompts.filter.collapseTags": "收起标签",
    "prompts.filter.moreTags": "+{count} 个标签",
    "prompts.filter.sortUpdated": "最近更新",
    "prompts.filter.sortUsage": "使用最多",
    "prompts.filter.sortCreated": "最新创建",

    /* ---------------------------------------------------------- 卡片 */
    "prompts.card.thumbTitle": "点击查看效果图与完整提示词",
    "prompts.card.imageCount": "{count} 张",
    "prompts.card.negativeLabel": "负向：",
    "prompts.card.usageCount": "已用 {count} 次",
    "prompts.card.structuredTag": "已结构化",

    /* ---------------------------------------------------------- 分页 */
    "prompts.pager.info": "第 {page} / {total} 页 · 共 {count} 条",
    "prompts.pager.prev": "上一页",
    "prompts.pager.next": "下一页",

    /* ---------------------------------------------------------- 编辑弹层 */
    "prompts.editor.createTitle": "新建提示词",
    "prompts.editor.editTitle": "编辑提示词",
    "prompts.editor.desc": "提示词会保存在本地，可随时复用到文生图工作台",
    "prompts.editor.titleLabel": "标题",
    "prompts.editor.titlePlaceholder": "给这条提示词起个名字",
    "prompts.editor.categoryLabel": "分类",
    "prompts.editor.favoriteLabel": "收藏",
    "prompts.editor.favoriteSwitch": "标记为常用",
    "prompts.editor.positiveLabel": "正向提示词",
    "prompts.editor.positivePlaceholder": "主体、场景、风格、镜头、光线、色彩…",
    "prompts.editor.negativeLabel": "负向提示词",
    "prompts.editor.negativePlaceholder": "低分辨率、模糊、水印、文字…",
    "prompts.editor.tagsLabel": "标签",
    "prompts.editor.charCount": "{count}/{max}",
    "prompts.editor.create": "创建提示词",
    "prompts.editor.save": "保存修改",

    /* ---------------------------------------------------------- 案例详情 */
    "prompts.preview.title": "案例详情",
    "prompts.preview.localSource": "本地",
    "prompts.preview.shotTitle": "第 {index} 张",
    "prompts.preview.shotAlt": "效果图 {index}",
    "prompts.preview.noImages": "这条案例在上游没有配效果图。",
    "prompts.preview.promptLabel": "提示词",
    "prompts.preview.charCount": "{count} 字符",
    "prompts.preview.negativeLabel": "负向提示词",
    "prompts.preview.viewSource": "查看来源",

    /* ---------------------------------------------------------- 仓库拉取 */
    "prompts.repo.title": "从 GitHub 仓库拉取提示词",
    "prompts.repo.desc": "拉取后内容保存在本地，之后无需联网即可使用；重新拉取会原地更新已有条目。",
    "prompts.repo.neverPulled": "尚未拉取",
    "prompts.repo.lastPulled": "上次拉取 {time} · 新增 {added} / 更新 {updated}",
    "prompts.repo.localCount": "本地 {count} 条",
    "prompts.repo.pulling": "正在拉取…",
    "prompts.repo.progress": "{done} / {total}",
    "prompts.repo.pull": "拉取",
    "prompts.repo.repull": "重新拉取",
    "prompts.repo.clearLocal": "清空本地",
    "prompts.repo.includeCollections": "同时拉取分类全集",
    "prompts.repo.includeCollectionsHint":
      "额外下载 cases/*.md 分类合集（约 2 MB），比主页精选案例更全，耗时也更长",
    "prompts.repo.footNote":
      "内容来自开源仓库（CC BY 4.0），拉取走 GitHub 接口，未登录状态下每小时约 60 次请求；触发限流时稍后再试即可，已拉取的内容不受影响。",
    "prompts.repo.step.connecting": "正在连接 GitHub…",

    /* ---------------------------------------------------------- 动作 */
    "prompts.action.create": "新建提示词",
    "prompts.action.import": "导入",
    "prompts.action.export": "导出",
    "prompts.action.pullRepo": "拉取仓库",
    "prompts.action.use": "去生图",
    "prompts.action.edit": "编辑",
    "prompts.action.favorite": "收藏",
    "prompts.action.unfavorite": "取消收藏",
    "prompts.action.remove": "删除",
    "prompts.action.resetFilters": "重置筛选",

    /* ---------------------------------------------------------- 空态 */
    "prompts.empty.title": "没有匹配的提示词",
    "prompts.empty.desc": "换个关键词，或从 GitHub 仓库拉取现成的案例集",

    /* ---------------------------------------------------------- 确认框 */
    "prompts.confirm.delete.title": "删除「{title}」？",
    "prompts.confirm.delete.desc": "删除后无法恢复，已生成的历史记录不受影响。",
    "prompts.confirm.clearRepo.title": "清空「{name}」的 {count} 条提示词？",
    "prompts.confirm.clearRepo.desc": "只删除从该仓库拉取的条目，自己新建、收藏与增强的内容不受影响。",
    "prompts.confirm.clearRepo.action": "清空",

    /* ---------------------------------------------------------- 提示消息 */
    "prompts.msg.copied": "已复制提示词",
    "prompts.msg.copyFailed.title": "复制失败",
    "prompts.msg.copyFailed.desc": "请手动选择文本复制",
    "prompts.msg.noSourceLink.title": "没有可打开的链接",
    "prompts.msg.noSourceLink.desc": "该条目没有记录来源地址",
    "prompts.msg.deleted": "已删除",
    "prompts.msg.exported": "已导出提示词库",
    "prompts.msg.exportedCount": "{count} 条",
    "prompts.msg.imported": "导入完成",
    "prompts.msg.importedCount": "新增 {count} 条提示词",
    "prompts.msg.importFailed": "导入失败",
    "prompts.msg.badFileFormat": "文件格式不支持，应为提示词数组",
    "prompts.msg.repoDone.title": "{name} 拉取完成",
    "prompts.msg.repoDone.desc": "新增 {added} 条，更新 {updated} 条，本地共 {total} 条",
    "prompts.msg.repoFailed.title": "拉取失败",
    "prompts.msg.repoUpToDate": "已是最新",
    "prompts.msg.repoUpToDate.desc": "本地已有 {total} 条，无需更新",
    "prompts.msg.repoPullFailed": "拉取提示词失败",
    "prompts.msg.repoBusy": "已有拉取任务在进行中",
    "prompts.msg.repoCleared": "已清空该来源",
    "prompts.msg.repoClearedCount": "共移除 {count} 条",
    "prompts.msg.openBrowserFailed": "无法打开浏览器",
    "prompts.msg.openBrowserFailedDesc": "仓库地址：{url}",
    "prompts.msg.repoNotFound": "仓库中找不到 {path}",
    "prompts.msg.repoNotFoundDesc": "仓库结构调整了？可先打开仓库确认文件路径。",
    "prompts.msg.repoRateLimited": "GitHub 接口触发限流",
    "prompts.msg.repoRateLimitedDesc":
      "未登录的 GitHub 接口每小时约 60 次请求，稍后再试即可；已拉取的内容不受影响。",
    "prompts.msg.repoFetchFailed": "拉取 {path} 失败（HTTP {status}）",

    /* ---------------------------------------------------------- 默认数据展示 */
    // 下面三个是**会写进 PromptItem 的默认字符串**：磁盘上存的仍是中文，
    // 展示时按 key 查表，这样老数据切到英文也能跟着变，又不破坏落盘内容。
    "prompts.default.untitled": "未命名提示词",
    "prompts.default.fromHistory": "来自历史记录",
    "prompts.default.imported": "导入提示词",
  },
  {
    /* ---------------------------------------------------------- 页头 */
    "prompts.title": "Prompt library",
    "prompts.stats": "{count} prompts · {usage} uses in total",
    "prompts.statsRepo": "{count} of them from repos · ",
    "prompts.statsLlmReady": "An LLM is connected — you can enhance prompts with one click",
    "prompts.statsLlmMissing": "Add an LLM API key to enable AI enhancement",

    /* ---------------------------------------------------------- 来源 */
    // source 枚举（manual/enhanced/builtin/history/repo）的展示名
    "prompts.source.builtin": "Built-in",
    "prompts.source.manual": "Mine",
    "prompts.source.enhanced": "AI enhanced",
    "prompts.source.history": "From history",
    "prompts.source.repo": "Repo",
    // 来源筛选按钮（含「不限」）
    "prompts.source.filterAll": "All",
    "prompts.source.filterBuiltin": "Built-in",
    "prompts.source.filterMine": "Mine",

    /* ---------------------------------------------------------- 分类 */
    // PROMPT_CATEGORIES 的展示名，顺序与 stores/prompts.ts 保持一致
    "prompts.category.portrait": "Portrait",
    "prompts.category.scene": "Scene",
    "prompts.category.product": "Product",
    "prompts.category.ecommerce": "E-commerce",
    "prompts.category.advertising": "Advertising",
    "prompts.category.poster": "Poster",
    "prompts.category.illustration": "Illustration",
    "prompts.category.character": "Character",
    "prompts.category.ui": "UI",
    "prompts.category.architecture": "Architecture",
    "prompts.category.concept": "Concept",
    "prompts.category.community": "Community",
    "prompts.category.other": "Other",

    /* ---------------------------------------------------------- 筛选与排序 */
    "prompts.filter.searchPlaceholder": "Search titles, content or tags…",
    "prompts.filter.favorite": "Favorites",
    "prompts.filter.allCategories": "All categories",
    "prompts.filter.collapseTags": "Collapse tags",
    "prompts.filter.moreTags": "+{count} more tags",
    "prompts.filter.sortUpdated": "Recently updated",
    "prompts.filter.sortUsage": "Most used",
    "prompts.filter.sortCreated": "Recently added",

    /* ---------------------------------------------------------- 卡片 */
    "prompts.card.thumbTitle": "Click to see the reference images and the full prompt",
    "prompts.card.imageCount": "{count} images",
    "prompts.card.negativeLabel": "Negative: ",
    "prompts.card.usageCount": "Used {count} times",
    "prompts.card.structuredTag": "Structured",

    /* ---------------------------------------------------------- 分页 */
    "prompts.pager.info": "Page {page} of {total} · {count} items",
    "prompts.pager.prev": "Previous",
    "prompts.pager.next": "Next",

    /* ---------------------------------------------------------- 编辑弹层 */
    "prompts.editor.createTitle": "New prompt",
    "prompts.editor.editTitle": "Edit prompt",
    "prompts.editor.desc": "Prompts are stored locally and can be reused in the text-to-image workbench",
    "prompts.editor.titleLabel": "Title",
    "prompts.editor.titlePlaceholder": "Give this prompt a name",
    "prompts.editor.categoryLabel": "Category",
    "prompts.editor.favoriteLabel": "Favorite",
    "prompts.editor.favoriteSwitch": "Mark as a favorite",
    "prompts.editor.positiveLabel": "Positive prompt",
    "prompts.editor.positivePlaceholder": "Subject, scene, style, lens, lighting, color…",
    "prompts.editor.negativeLabel": "Negative prompt",
    "prompts.editor.negativePlaceholder": "Low resolution, blur, watermark, text…",
    "prompts.editor.tagsLabel": "Tags",
    "prompts.editor.charCount": "{count}/{max}",
    "prompts.editor.create": "Create prompt",
    "prompts.editor.save": "Save changes",

    /* ---------------------------------------------------------- 案例详情 */
    "prompts.preview.title": "Example details",
    "prompts.preview.localSource": "Local",
    "prompts.preview.shotTitle": "Image {index}",
    "prompts.preview.shotAlt": "Reference image {index}",
    "prompts.preview.noImages": "This example has no reference image upstream.",
    "prompts.preview.promptLabel": "Prompt",
    "prompts.preview.charCount": "{count} characters",
    "prompts.preview.negativeLabel": "Negative prompt",
    "prompts.preview.viewSource": "View source",

    /* ---------------------------------------------------------- 仓库拉取 */
    "prompts.repo.title": "Pull prompts from GitHub",
    "prompts.repo.desc":
      "Pulled content is stored locally and works offline afterwards; pulling again updates existing entries in place.",
    "prompts.repo.neverPulled": "Never pulled",
    "prompts.repo.lastPulled": "Last pulled {time} · {added} added / {updated} updated",
    "prompts.repo.localCount": "{count} local",
    "prompts.repo.pulling": "Pulling…",
    "prompts.repo.progress": "{done} / {total}",
    "prompts.repo.pull": "Pull",
    "prompts.repo.repull": "Pull again",
    "prompts.repo.clearLocal": "Clear local",
    "prompts.repo.includeCollections": "Also pull the category collections",
    "prompts.repo.includeCollectionsHint":
      "Downloads the cases/*.md collections as well (about 2 MB) — far more complete than the curated homepage list, but slower",
    "prompts.repo.footNote":
      "Content comes from open-source repositories (CC BY 4.0) and is pulled through the GitHub API, which allows roughly 60 requests per hour when signed out. If you hit the rate limit, try again later — already-pulled content is unaffected.",
    "prompts.repo.step.connecting": "Connecting to GitHub…",

    /* ---------------------------------------------------------- 动作 */
    "prompts.action.create": "New prompt",
    "prompts.action.import": "Import",
    "prompts.action.export": "Export",
    "prompts.action.pullRepo": "Pull from repo",
    "prompts.action.use": "Generate",
    "prompts.action.edit": "Edit",
    "prompts.action.favorite": "Favorite",
    "prompts.action.unfavorite": "Remove from favorites",
    "prompts.action.remove": "Delete",
    "prompts.action.resetFilters": "Reset filters",

    /* ---------------------------------------------------------- 空态 */
    "prompts.empty.title": "No matching prompts",
    "prompts.empty.desc": "Try a different keyword, or pull a ready-made set from a GitHub repo",

    /* ---------------------------------------------------------- 确认框 */
    "prompts.confirm.delete.title": "Delete “{title}”?",
    "prompts.confirm.delete.desc": "This cannot be undone. Existing history records are not affected.",
    "prompts.confirm.clearRepo.title": "Clear {count} prompts from “{name}”?",
    "prompts.confirm.clearRepo.desc":
      "Only entries pulled from this repo are deleted — your own, favorited and enhanced prompts stay untouched.",
    "prompts.confirm.clearRepo.action": "Clear",

    /* ---------------------------------------------------------- 提示消息 */
    "prompts.msg.copied": "Prompt copied",
    "prompts.msg.copyFailed.title": "Copy failed",
    "prompts.msg.copyFailed.desc": "Select the text and copy it manually",
    "prompts.msg.noSourceLink.title": "No link to open",
    "prompts.msg.noSourceLink.desc": "This entry has no source URL recorded",
    "prompts.msg.deleted": "Deleted",
    "prompts.msg.exported": "Prompt library exported",
    "prompts.msg.exportedCount": "{count} prompts",
    "prompts.msg.imported": "Import complete",
    "prompts.msg.importedCount": "Added {count} prompts",
    "prompts.msg.importFailed": "Import failed",
    "prompts.msg.badFileFormat": "Unsupported file format — expected an array of prompts",
    "prompts.msg.repoDone.title": "{name} pull complete",
    "prompts.msg.repoDone.desc": "{added} added, {updated} updated, {total} in total",
    "prompts.msg.repoFailed.title": "Pull failed",
    "prompts.msg.repoUpToDate": "Already up to date",
    "prompts.msg.repoUpToDate.desc": "You already have {total} prompts — nothing to update",
    "prompts.msg.repoPullFailed": "Pulling prompts failed",
    "prompts.msg.repoBusy": "A pull is already in progress",
    "prompts.msg.repoCleared": "Cleared this source",
    "prompts.msg.repoClearedCount": "Removed {count} prompts",
    "prompts.msg.openBrowserFailed": "Could not open the browser",
    "prompts.msg.openBrowserFailedDesc": "Repository: {url}",
    "prompts.msg.repoNotFound": "{path} not found in the repository",
    "prompts.msg.repoNotFoundDesc": "Was the repository restructured? Open it and check the file path.",
    "prompts.msg.repoRateLimited": "GitHub API rate limit reached",
    "prompts.msg.repoRateLimitedDesc":
      "The unsigned GitHub API allows about 60 requests per hour — try again later; already-pulled content is unaffected.",
    "prompts.msg.repoFetchFailed": "Failed to pull {path} (HTTP {status})",

    /* ---------------------------------------------------------- 默认数据展示 */
    // 下面三个是**会写进 PromptItem 的默认字符串**：磁盘上存的仍是中文，
    // 展示时按 key 查表，这样老数据切到英文也能跟着变，又不破坏落盘内容。
    "prompts.default.untitled": "Untitled prompt",
    "prompts.default.fromHistory": "From history",
    "prompts.default.imported": "Imported prompt",
  },
);
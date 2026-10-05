/* ==========================================================================
   提示词仓库（GitHub）拉取与解析

   两个开源案例库都是「Markdown 案例集」的形式：
       ## 分类标题
       ### Case 12: [案例标题](原推链接) (by [@作者](链接))
       | ![](案例效果图) |
       **Prompt:**
       ``` …```
   所以这里做三件事：
   1. 经 platform/http.ts（桌面端走 Rust reqwest）拉取仓库里的 Markdown；
   2. 把 Markdown 拆成一条条提示词条目（含案例效果图的地址）；
   3. 交给 prompts store 做入库去重。

   只用 GitHub 的 contents 接口（api.github.com），不带 extra ref：
   它会自动落在仓库的默认分支上，仓库改分支也不用改代码。
   ========================================================================== */

import { ApiError, base64ToBytes, requestRaw, type RawResponse } from "../platform/http";

const GH_API = "https://api.github.com";

/** 单个待拉取文档 */
export interface PromptSourceFile {
  path: string;
  /** 展示给用户的中文名称 */
  label: string;
  /** 文档整体归属的分类（标题里识别不出分类时用它兜底） */
  category?: string;
}

export interface PromptSource {
  id: string;
  /** owner/name */
  repo: string;
  name: string;
  /** 筛选栏里用的短名 */
  shortName: string;
  summary: string;
  license: string;
  /** 默认拉取的文档（仓库主页的精选案例） */
  docs: PromptSourceFile[];
  /** 可选的分类全集（体积更大，内容更全） */
  collections?: PromptSourceFile[];
}

/**
 * 内置来源。
 * 内容分别来自 EvoLinkAI 的两个开源案例库（CC BY 4.0），
 * 拉取后保存在本地，运行时不再访问网络。
 */
export const PROMPT_SOURCES: PromptSource[] = [
  {
    id: "awesome-gpt-image-2",
    repo: "EvoLinkAI/awesome-gpt-image-2-API-and-Prompts",
    name: "Awesome GPT Image 2 Prompts",
    shortName: "Awesome 案例",
    summary: "社区精选案例库，覆盖电商、广告、人像、海报、角色、UI 六大类，每条案例都附原推链接。",
    license: "CC BY 4.0",
    docs: [{ path: "README.md", label: "主页精选案例" }],
    collections: [
      { path: "cases/ecommerce.md", label: "电商", category: "电商" },
      { path: "cases/ad-creative.md", label: "广告", category: "广告" },
      { path: "cases/portrait.md", label: "人像与摄影", category: "人像" },
      { path: "cases/poster.md", label: "海报与插画", category: "海报" },
      { path: "cases/character.md", label: "角色设计", category: "角色" },
      { path: "cases/ui.md", label: "UI 与社媒", category: "UI" },
      { path: "cases/comparison.md", label: "对比与社区", category: "社区" },
    ],
  },
  {
    id: "gpt-image-2.5-ecommerce",
    repo: "EvoLinkAI/gpt-image-2.5-for-e-commerce",
    name: "GPT Image 2.5 for E-commerce",
    shortName: "电商手册",
    summary: "电商专用提示词手册：商品 listing、模特试穿、产品展示、场景互动与社媒素材，多为可填空模板。",
    license: "CC BY 4.0",
    docs: [{ path: "README.md", label: "电商提示词手册" }],
  },
];

/** 解析结果：一条待入库的仓库提示词 */
export interface RepoPromptEntry {
  /** 稳定标识，用于重新拉取时原地更新 */
  sourceKey: string;
  repo: string;
  docPath: string;
  caseId: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  author?: string;
  /** 原推 / 仓库文档链接 */
  url: string;
  /** 案例效果图（仓库里的直链，最多 3 张） */
  images: string[];
}

/** 单条案例最多保留几张效果图：卡片只需要一眼看懂「长什么样」 */
const MAX_IMAGES = 3;

/**
 * raw.githubusercontent.com 在国内时通时不通，给图片补两个公共镜像做兜底。
 * 只对 GitHub 原图地址生效，仓库自建 CDN（如 R2）保持原样。
 */
const RAW_MIRRORS = ["https://gh-proxy.com/", "https://ghfast.top/"];

/** 图片候选地址：优先官方直链，失败时由组件自动退到镜像 */
export function remoteImageCandidates(url: string): string[] {
  if (!url) return [];
  const list = [url];
  if (/^https:\/\/raw\.githubusercontent\.com\//i.test(url)) {
    for (const prefix of RAW_MIRRORS) list.push(`${prefix}${url}`);
  }
  return list;
}

export interface PullProgress {
  /** 当前正在处理的文档 */
  step: string;
  done: number;
  total: number;
}

/* ------------------------------------------------------------ 分类映射 */

const CATEGORY_RULES: Array<[RegExp, string]> = [
  [/e-?commerce|listing|try-?on|apparel|social commerce/i, "电商"],
  [/product\s+(showcase|interaction)|product photography/i, "产品"],
  [/ad[-\s]?creative|advertis|\bads?\b/i, "广告"],
  [/portrait|photograph/i, "人像"],
  [/poster|illustration/i, "海报"],
  [/character/i, "角色"],
  [/\bui\b|mockup/i, "UI"],
  [/comparison|community/i, "社区"],
  [/scene|interaction/i, "场景"],
];

function categoryOf(heading: string): string | null {
  for (const [pattern, category] of CATEGORY_RULES) {
    if (pattern.test(heading)) return category;
  }
  return null;
}

/* ------------------------------------------------------------ 文本清洗 */

/** 标题里抽出可读的关键词做标签 */
const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "your",
  "that",
  "this",
  "photo",
  "photos",
  "photography",
  "image",
  "images",
  "prompt",
  "prompts",
  "case",
  "shot",
  "shots",
  "set",
  "using",
  "create",
  "make",
  "make",
  "style",
  "styled",
]);

function tagsFromTitle(title: string): string[] {
  const words = title
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && word.length <= 14 && !STOP_WORDS.has(word));
  return Array.from(new Set(words)).slice(0, 4);
}

/** `{argument name="aspect ratio" default="9:16"}` → `9:16`，没有默认值则保留占位符 */
function normalizeArguments(text: string): string {
  return text.replace(/\{argument\s+name="([^"]+)"(?:\s+default="([^"]*)")?\s*\}/gi, (_all, name: string, value?: string) =>
    value ? value : `{${name}}`,
  );
}

/** 去掉正文开头的 “prompt:” / “full prompt:” 之类的引导行 */
function stripPromptLead(text: string): string {
  const lines = text.split("\n");
  let index = 0;
  while (index < lines.length && !lines[index].trim()) index += 1;
  if (index < lines.length && /^(full\s+)?prompt\s*:?\s*$/i.test(lines[index].trim())) index += 1;
  return lines.slice(index).join("\n").trim();
}

function tidyPrompt(raw: string): string {
  const text = normalizeArguments(stripPromptLead(raw))
    // 仓库里有时把上一条案例的锚点注释留在代码块里
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s+|\s+$/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > 8000 ? `${text.slice(0, 8000)}…` : text;
}

/* ------------------------------------------------------------ Markdown 解析 */

const CASE_HEADING = /^(#{3,4})\s+(?:(case|example)\s*(\d+)\s*[:：]\s*)?(.+?)\s*$/i;
const ANY_HEADING = /^(#{1,4})\s+(.+?)\s*$/;
const PROMPT_MARKER = /^\*\*[^*]{0,24}prompt\s*:?\*\*:?\s*$/i;
const MD_LINK = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/;
const AUTHOR = /\[@([A-Za-z0-9_.-]+)\]/;
/** 标题末尾的署名段：`(by [@x](url))` / `(Community, by [@x](url))` */
const AUTHOR_TAIL = /\s*[(（][^()（）]*(?:by|community|original)[^()（）]*[)）]\s*$/i;
const IMG_TAG = /<img[^>]*\ssrc="([^"]+)"/gi;
const IMG_MD = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif|bmp)(\?|#|$)/i;

interface CaseContext {
  caseId: string;
  title: string;
  url: string;
  author?: string;
}

interface DocHeading {
  line: number;
  level: number;
  /** 1–2 级标题识别出的分类 */
  category?: string;
  /** 3–4 级标题解析出的案例信息 */
  ctx?: CaseContext;
  /** 该标题区块内的案例效果图 */
  images: string[];
}

function parseCaseHeading(line: string): CaseContext | null {
  const match = CASE_HEADING.exec(line);
  if (!match) return null;
  const kind = match[2] ? match[2].toLowerCase() : "";
  const num = match[3] ?? "";
  const rest = match[4] ?? "";
  // 先摘掉署名，再取标题链接——否则「无标题链接 + 有作者链接」的写法会把作者名当成标题
  const head = rest.replace(AUTHOR_TAIL, "").trim();
  const link = MD_LINK.exec(head);
  return {
    caseId: kind ? `${kind === "case" ? "Case" : "Example"} ${num}`.trim() : head,
    title: (link?.[1] ?? head).trim() || "未命名案例",
    url: link?.[2] ?? "",
    author: AUTHOR.exec(rest)?.[1],
  };
}

/** 从一行 Markdown 里抠出图片地址 */
function imagesInLine(line: string): string[] {
  if (!line.includes("<img") && !line.includes("![")) return [];
  const found: string[] = [];
  for (const match of line.matchAll(IMG_TAG)) found.push(match[1]);
  for (const match of line.matchAll(IMG_MD)) found.push(match[1]);
  return found.filter((url) => IMAGE_EXT.test(url));
}

/**
 * 标记每一行是否位于代码块内。
 * 仓库里确实存在没闭合好的围栏（提示词正文里带 ``` ），
 * 于是正文里「看起来像标题的一行」会被误当成章节/案例，把分类串掉。
 */
function markFences(lines: string[]): boolean[] {
  const flags: boolean[] = [];
  let inside = false;
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inside = !inside;
      flags.push(true);
      continue;
    }
    flags.push(inside);
  }
  return flags;
}

/**
 * 仓库里不少案例图写的是相对路径（`images/x.jpg`、`../images/x.jpg`），
 * 统一补成 raw 直链；用 `HEAD` 指向默认分支，仓库改分支名也不会失效。
 */
function resolveImageUrl(raw: string, repo: string, docPath: string): string {
  const url = raw.trim();
  if (!url || /^data:/i.test(url)) return "";
  if (/^https?:\/\//i.test(url)) return url;

  const stack: string[] = [];
  const absolute = url.startsWith("/");
  const baseDir = absolute || !docPath.includes("/") ? "" : docPath.slice(0, docPath.lastIndexOf("/"));
  for (const part of `${baseDir}/${url.replace(/^\/+/, "")}`.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return `https://raw.githubusercontent.com/${repo}/HEAD/${stack.join("/")}`;
}

/**
 * 各标题区块内的图片。
 * 必须先把区块扫完再解析提示词：仓库 2 的案例是「先 Prompt 再示例图」，
 * 边扫边收会一张都拿不到。
 */
function collectHeadingImages(
  lines: string[],
  fenced: boolean[],
  headings: DocHeading[],
  meta: { repo: string; docPath: string },
) {
  headings.forEach((heading, index) => {
    if (heading.level < 3) return;
    let end = lines.length;
    for (let j = index + 1; j < headings.length; j += 1) {
      if (headings[j].level <= heading.level) {
        end = headings[j].line;
        break;
      }
    }
    const set = new Set<string>();
    for (let line = heading.line + 1; line < end && set.size < MAX_IMAGES; line += 1) {
      if (fenced[line]) continue;
      for (const raw of imagesInLine(lines[line])) {
        const url = resolveImageUrl(raw, meta.repo, meta.docPath);
        if (url) set.add(url);
      }
    }
    heading.images = Array.from(set).slice(0, MAX_IMAGES);
  });
}

/** 把一段 Markdown 切成提示词条目 */
export function parseRepoPrompts(
  markdown: string,
  meta: { repo: string; docPath: string; fallbackCategory: string },
): RepoPromptEntry[] {
  const lines = markdown.split(/\r?\n/);
  const entries: RepoPromptEntry[] = [];
  const docUrl = `https://github.com/${meta.repo}/blob/HEAD/${meta.docPath}`;
  // 同一个文档里 Case 编号可能重复（多个小节各自从 1 开始），用出现次数区分
  const seenKeys = new Map<string, number>();

  const headings: DocHeading[] = [];
  const fenced = markFences(lines);
  lines.forEach((line, index) => {
    if (fenced[index]) return;
    const match = ANY_HEADING.exec(line);
    if (!match) return;
    const level = match[1].length;
    if (level <= 2) {
      headings.push({ line: index, level, category: categoryOf(match[2]) ?? undefined, images: [] });
      return;
    }
    const ctx = parseCaseHeading(line);
    if (ctx) headings.push({ line: index, level, ctx, images: [] });
  });
  collectHeadingImages(lines, fenced, headings, { repo: meta.repo, docPath: meta.docPath });

  let category = meta.fallbackCategory;
  let current: CaseContext | null = null;
  let currentImages: string[] = [];
  let headingCursor = -1;

  for (let i = 0; i < lines.length; i += 1) {
    // 推进标题指针：走过哪个标题，就切到它带来的分类 / 案例与图片
    while (headingCursor + 1 < headings.length && headings[headingCursor + 1].line <= i) {
      headingCursor += 1;
      const heading = headings[headingCursor];
      if (heading.level <= 2) {
        category = heading.category ?? meta.fallbackCategory;
      } else if (heading.ctx) {
        current = heading.ctx;
        currentImages = heading.images;
      }
    }

    const line = lines[i];
    if (!PROMPT_MARKER.test(line.trim())) continue;

    // 标记行之后应当紧跟一个代码块；中间允许有空行
    let cursor = i + 1;
    while (cursor < lines.length && !lines[cursor].trim()) cursor += 1;
    if (cursor >= lines.length || !lines[cursor].trim().startsWith("```")) continue;

    const body: string[] = [];
    for (let j = cursor + 1; j < lines.length; j += 1) {
      if (lines[j].trim().startsWith("```")) {
        cursor = j;
        break;
      }
      body.push(lines[j]);
      cursor = j;
    }

    const content = tidyPrompt(body.join("\n"));
    if (content.length >= 20) {
      const ctx = current ?? { caseId: "未编号", title: "仓库案例", url: "" };
      const base = `${meta.repo}::${meta.docPath}::${ctx.caseId}`;
      const seen = (seenKeys.get(base) ?? 0) + 1;
      seenKeys.set(base, seen);
      const title = ctx.title;
      entries.push({
        sourceKey: seen === 1 ? base : `${base}#${seen}`,
        repo: meta.repo,
        docPath: meta.docPath,
        caseId: ctx.caseId,
        title,
        content,
        category,
        tags: tagsFromTitle(title),
        author: ctx.author,
        url: ctx.url || docUrl,
        images: currentImages,
      });
    }
    i = cursor;
  }

  return entries;
}

/* ------------------------------------------------------------ 网络拉取 */

function decodeText(res: RawResponse): string {
  if (!res.isBase64) return res.body;
  return new TextDecoder().decode(base64ToBytes(res.body));
}

/** 读取仓库中的单个文本文件（走 GitHub contents 接口的 raw 媒体类型） */
async function fetchRepoFile(repo: string, path: string, label: string): Promise<string> {
  const res = await requestRaw({
    method: "GET",
    url: `${GH_API}/repos/${repo}/contents/${encodeURI(path)}`,
    headers: {
      Accept: "application/vnd.github.raw",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    timeoutMs: 90_000,
    label: `${label} · ${path}`,
  });

  if (!res.ok) {
    if (res.status === 404) throw new ApiError(`仓库中找不到 ${path}`, 404, res.body, "仓库结构调整了？可先打开仓库确认文件路径。");
    if (res.status === 403 || res.status === 429) {
      throw new ApiError(
        "GitHub 接口触发限流",
        res.status,
        res.body,
        "未登录的 GitHub 接口每小时约 60 次请求，稍后再试即可；已拉取的内容不受影响。",
      );
    }
    throw new ApiError(`拉取 ${path} 失败（HTTP ${res.status}）`, res.status, res.body);
  }
  return decodeText(res);
}

export interface PullOptions {
  /** 是否连同分类全集一起拉取 */
  includeCollections?: boolean;
  onProgress?: (progress: PullProgress) => void;
}

export interface PullResult {
  entries: RepoPromptEntry[];
  /** 成功拉取的文档 */
  docs: number;
  /** 跳过的文档（例如 404） */
  failures: Array<{ path: string; message: string }>;
}

/** 拉取某个来源的全部提示词 */
export async function pullPromptSource(source: PromptSource, options: PullOptions = {}): Promise<PullResult> {
  const files = [...source.docs, ...(options.includeCollections ? (source.collections ?? []) : [])];
  const entries: RepoPromptEntry[] = [];
  const failures: PullResult["failures"] = [];
  let docs = 0;

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    options.onProgress?.({ step: `${source.name} · ${file.label}`, done: i, total: files.length });
    try {
      const text = await fetchRepoFile(source.repo, file.path, "提示词仓库");
      const parsed = parseRepoPrompts(text, {
        repo: source.repo,
        docPath: file.path,
        fallbackCategory: file.category ?? "其他",
      });
      entries.push(...parsed);
      docs += 1;
    } catch (err) {
      // 单个文档失败不影响整体，例如某个分类文件被上游移走了
      failures.push({ path: file.path, message: err instanceof Error ? err.message : String(err) });
    }
  }

  options.onProgress?.({ step: source.name, done: files.length, total: files.length });

  // 同一份文档内可能重复（README 与全集重叠），按 sourceKey + 正文去重
  const seen = new Set<string>();
  const unique = entries.filter((entry) => {
    const key = entry.sourceKey;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { entries: unique, docs, failures };
}

/** 仓库条目的来源仓库展示名（筛选栏、卡片徽标共用） */
export function sourceShortNameOf(repo?: string): string {
  if (!repo) return "仓库";
  return PROMPT_SOURCES.find((item) => item.repo === repo)?.shortName ?? repo;
}

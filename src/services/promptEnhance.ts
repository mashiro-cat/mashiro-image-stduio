/* ==========================================================================
   提示词智能增强：把一句话想法（可带参考图）扩写为完整的结构化生图提示词
   ========================================================================== */

import type { EnhanceOptions, EnhanceResult, HistoryRecord, LlmConfig, StructuredPrompt } from "../types";
import { ApiError } from "../platform/http";
import { sizeLabelZh } from "../platform/env";
import { chatCompletion, parseJsonLoose, type ChatContentPart, type ChatMessage } from "./llmApi";

const EMPTY_STRUCTURED: StructuredPrompt = {
  subject: "",
  scene: "",
  style: "",
  lens: "",
  lighting: "",
  color: "",
  negative: "",
};

/** 随请求一起发送的参考图数量上限（多模态输入很吃 token，4 张足够表达意图） */
export const MAX_VISION_IMAGES = 4;

/**
 * 增强用的系统提示词：它决定「怎么增强」——扩写顺序、长度、语言、
 * 参考图如何使用、以及必须返回的 JSON 结构。
 *
 * 只放与「有没有图」无关的通用规则；看图相关的说明见 VISION_SECTION。
 */
export const BASE_ENHANCE_SYSTEM_PROMPT = `你是一位资深的 AI 绘画提示词工程师，精通 Midjourney / Stable Diffusion / GPT-Image 等文生图模型的提示词写法。
你的唯一任务：把用户零散、简单的想法扩写成一条高质量、可直接投喂给文生图模型的提示词。

【扩写规则】
1. 只做扩写与细化，不改变用户的核心意图；不要捏造与原意冲突的新主体，也不要把用户没提过的品牌、人物、文字硬塞进去。
2. 信息顺序固定为：主体 → 动作与表情 → 服饰与材质 → 环境与场景 → 构图与镜头 → 光线 → 色彩 → 风格 → 画质。
3. 正向提示词写成逗号分隔的短语堆叠，不要写成完整句子，不要出现「请生成」「画面中」「这是一张」之类指令性口吻。
4. 细节必须具体且可视觉化（材质、景深、光照方向、镜头焦段、渲染方式），用可观测的描写替代空泛形容词。
5. 正向提示词长度控制在 60~110 个英文单词；负向提示词 20~40 个单词，覆盖低画质、结构错误、文字水印等常见问题。
6. 按消息中【输出语言】的要求书写正向与负向提示词，不要自行改变。
7. 不要输出思考过程、分析步骤、前言后记或任何解释文字，直接给出结果。

【输出格式】
只返回一个 JSON 对象（不要 markdown 代码块，不要任何前后缀），结构如下：
{
  "prompt": "正向提示词",
  "negative": "负向提示词，逗号分隔",
  "structured": {
    "subject": "主体（中文简述）",
    "scene": "场景（中文简述）",
    "style": "风格（中文简述）",
    "lens": "镜头与构图（中文简述）",
    "lighting": "光线（中文简述）",
    "color": "色彩（中文简述）",
    "negative": "负向提示词要点（中文简述）"
  },
  "notes": ["本次扩写所做的关键改动，3~5 条，每条不超过 20 字"]
}`;

/**
 * 看图说明：**只在请求真的带了参考图时才拼进系统提示词**。
 * 文生图场景（没有图）必须一个字都不出现——否则模型会以为「应该有图却没收到」。
 */
export const VISION_SECTION = `【随消息附带的图片】
这些图片是用户提供的参考图（图生图场景）。请先看图，再做增强：
- 准确描述图中既有的主体、构图、光线与风格特征，让扩写结果能复现这些特征；
- 用户想法与图片冲突时以用户想法为准，图片作为风格与结构的参照；
- 不要在提示词里写「参考图」「如图」这类指代，把观察到的内容直接写成画面描述。`;

/** 内置规则 +（按需）看图说明 + 用户在设置页追加的要求 */
export function buildEnhanceSystemPrompt(config: LlmConfig, withImages = false): string {
  const sections = [BASE_ENHANCE_SYSTEM_PROMPT];
  if (withImages) sections.push(VISION_SECTION);
  const extra = (config.systemPrompt ?? "").trim();
  if (extra) sections.push(`【用户追加的增强要求，优先级高于上面的通用规则】\n${extra}`);
  return sections.join("\n\n");
}

export interface EnhanceInput {
  /** 用户原始输入 */
  prompt: string;
  /** 已有的负向提示词 */
  negative?: string;
  /** 参考图数量，帮助模型理解这是图生图场景 */
  referenceCount?: number;
  /** 参考图（data URL），有值时走多模态请求 */
  images?: string[];
  options: EnhanceOptions;
}

/** 纯文本部分的用户消息 */
function buildUserMessage(input: EnhanceInput, imageCount: number): string {
  const parts: string[] = [];
  parts.push(`【用户原始想法】${input.prompt.trim()}`);
  if (input.negative?.trim()) parts.push(`【用户已写的负向提示词】${input.negative.trim()}`);
  if (imageCount) {
    parts.push(
      `【场景】图生图：消息中附带 ${imageCount} 张参考图，请先理解图片内容，再结合用户想法扩写；保留参考图的主体结构与风格特征。`,
    );
  } else if (input.referenceCount) {
    parts.push(`【场景】图生图，将基于 ${input.referenceCount} 张参考图进行编辑，请保留参考图的主体结构。`);
  }
  parts.push(`【目标风格】${input.options.style || "不限定，按想法自行判断最合适的风格"}`);
  parts.push(`【输出语言】正向与负向提示词使用${input.options.language === "zh" ? "中文" : "英文"}`);
  parts.push("【现在开始】只返回约定的 JSON 对象。");
  return parts.join("\n");
}

/** 带图时按 OpenAI 多模态格式组装 content 数组 */
function buildUserContent(input: EnhanceInput, images: string[]): ChatContentPart[] {
  const parts: ChatContentPart[] = [{ type: "text", text: buildUserMessage(input, images.length) }];
  for (const url of images) {
    parts.push({ type: "image_url", image_url: { url } });
  }
  return parts;
}

/** 模型没按 JSON 返回时，尽量把正文里的提示词择出来 */
function sanitizePlainPrompt(text: string): string {
  return text
    .replace(/```[a-z]*/gi, "")
    .replace(/```/g, "")
    .replace(/^\s*(好的|当然|没问题|以下是|下面是|已为你)[^\n]*\n+/u, "")
    .trim();
}

function normalizeResult(raw: unknown, fallbackPrompt: string, fallbackNegative: string): EnhanceResult {
  const record = (raw ?? {}) as Record<string, unknown>;
  const structuredRaw = (record.structured ?? {}) as Record<string, unknown>;
  const asText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

  const structured: StructuredPrompt = {
    subject: asText(structuredRaw.subject),
    scene: asText(structuredRaw.scene),
    style: asText(structuredRaw.style),
    lens: asText(structuredRaw.lens),
    lighting: asText(structuredRaw.lighting),
    color: asText(structuredRaw.color),
    negative: asText(structuredRaw.negative),
  };

  const prompt = asText(record.prompt) || asText(record.enhanced_prompt) || fallbackPrompt;
  const negative = asText(record.negative) || asText(record.negative_prompt) || fallbackNegative;

  const notesRaw = record.notes ?? record.changes;
  const notes = Array.isArray(notesRaw)
    ? notesRaw.map((item) => asText(item)).filter(Boolean)
    : [];

  return { prompt, negative, structured, notes };
}

/** 调用 LLM 增强提示词（带参考图时走多模态） */
export async function enhancePrompt(config: LlmConfig, input: EnhanceInput): Promise<EnhanceResult> {
  if (!input.prompt.trim()) throw new ApiError("请先输入提示词");

  const images = (input.images ?? []).slice(0, MAX_VISION_IMAGES);
  const messages: ChatMessage[] = [
    // 看图说明只在真的带图时才给：文生图的请求里不该出现任何图片相关描述
    { role: "system", content: buildEnhanceSystemPrompt(config, images.length > 0) },
    { role: "user", content: images.length ? buildUserContent(input, images) : buildUserMessage(input, 0) },
  ];

  const content = await chatCompletion(config, messages, {
    json: config.jsonMode,
    // 思考模式只产出过程不产出结果，增强场景一律关掉
    disableThinking: config.disableThinking,
    temperature: 0.75,
    maxTokens: Math.max(config.maxTokens, 1400),
    label: images.length ? `提示词增强 · 多模态扩写（${images.length} 张参考图）` : "提示词增强 · 结构化扩写",
  });

  const parsed = parseJsonLoose<unknown>(content);
  if (!parsed) {
    // 模型未按 JSON 返回时，退化为纯文本结果
    const prompt = sanitizePlainPrompt(content);
    if (!prompt) throw new ApiError("模型未返回可用的提示词，请重试或更换模型");
    return {
      prompt,
      negative: input.negative ?? "",
      structured: { ...EMPTY_STRUCTURED },
      notes: ["模型未返回结构化数据，已直接采用文本结果"],
    };
  }
  return normalizeResult(parsed, input.prompt, input.negative ?? "");
}

/** 只需负向提示词时的轻量增强 */
export async function suggestNegative(config: LlmConfig, prompt: string): Promise<string> {
  const content = await chatCompletion(
    config,
    [
      {
        role: "system",
        content:
          "你是 AI 绘画提示词工程师。请针对用户给出的正向提示词，输出一条针对性的英文负向提示词，逗号分隔，只输出提示词本身，不要解释。",
      },
      { role: "user", content: prompt },
    ],
    { temperature: 0.5, maxTokens: 300, disableThinking: config.disableThinking, label: "提示词增强 · 负向词" },
  );
  return content.replace(/^["'`]|["'`]$/g, "").trim();
}

/* ------------------------------------------------------------ 提示词反推（看图写词） */

/**
 * 反推用的系统提示词：与「增强」方向相反——增强是「把想法写细」，
 * 反推是「把画面读回来」。观察顺序与增强的扩写顺序保持一致，便于两者结果互相对照。
 */
export const REVERSE_IMAGE_SYSTEM_PROMPT = `你是一位资深的 AI 绘画提示词工程师，精通 Midjourney / Stable Diffusion / GPT-Image 等文生图模型的提示词写法。
你的唯一任务：观察用户提供的图片，反推出一条能最大程度复现该画面的提示词。

【观察顺序】
主体 → 动作与神态 → 服饰与材质 → 环境与场景 → 构图与镜头 → 光线 → 色彩 → 风格 → 画质

【反推规则】
1. 只描述画面里真实存在的内容，不要臆造画面上没有的元素，也不要写品牌名、人物名或任何文字内容。
2. 不要出现「这张图」「参考图」「画面中」「这是一张」这类指代性表述，把观察到的内容直接写成画面描述。
3. 正向提示词写成逗号分隔的短语堆叠，不要写成完整句子；用可观测的描写（材质、景深、光照方向、镜头焦段、渲染方式）替代空泛形容词。
4. 正向提示词长度控制在 60~110 个英文单词；负向提示词 20~40 个单词，覆盖低画质、结构错误、文字水印等常见问题。
5. 按消息中【输出语言】的要求书写正向与负向提示词，不要自行改变。
6. 不要输出思考过程、分析步骤、前言后记或任何解释文字，直接给出结果。

【输出格式】
只返回一个 JSON 对象（不要 markdown 代码块，不要任何前后缀），结构如下：
{
  "prompt": "正向提示词",
  "negative": "负向提示词，逗号分隔",
  "structured": {
    "subject": "主体（中文简述）",
    "scene": "场景（中文简述）",
    "style": "风格（中文简述）",
    "lens": "镜头与构图（中文简述）",
    "lighting": "光线（中文简述）",
    "color": "色彩（中文简述）",
    "negative": "负向提示词要点（中文简述）"
  },
  "notes": ["反推依据的关键观察，3~5 条，每条不超过 20 字"]
}`;

/** 没有图片时的参数复盘：拿历史记录里的参数与提示词倒推 */
export const REVERSE_RECORD_SYSTEM_PROMPT = `你是一位资深的 AI 绘画提示词工程师。
你的唯一任务：根据给定的生成信息（模型、尺寸、当时的提示词与负向词），反推出一条结构完整、可直接复用的提示词。

【规则】
1. 保留原提示词里已经写明的画面内容，只做结构化改写与细节补全，不要另起一套完全不同的画面。
2. 补齐原提示词缺失的维度：镜头、光线、色彩、画质；
3. 正向提示词写成逗号分隔的短语堆叠，60~110 个英文单词；负向提示词 20~40 个单词。
4. 按消息中【输出语言】的要求书写，不要自行改变。
5. 不要输出思考过程或任何解释文字，直接给出结果。

【输出格式】
与上面完全一致：只返回含 prompt / negative / structured / notes 的 JSON 对象，不要 markdown 代码块。`;

interface ReverseInput {
  /** 有图时走多模态「看图写词」 */
  images?: string[];
  /** 无图时退回「参数复盘」 */
  record?: HistoryRecord;
  /** 目标风格（只作倾向，不改变画面既有内容） */
  style?: string;
  language?: "en" | "zh";
}

function buildReverseUserMessage(input: ReverseInput, imageCount: number): string {
  const parts: string[] = [];
  if (imageCount) {
    parts.push(`【任务】观察消息中附带的 ${imageCount} 张图片，反推一条能复现该画面的提示词。`);
  } else if (input.record) {
    const record = input.record;
    parts.push("【任务】根据下列生成信息，反推一条能复现该画面的提示词。");
    parts.push(`【模式】${record.mode}`);
    if (record.params.model) parts.push(`【模型】${record.params.model}`);
    if (record.params.size) parts.push(`【尺寸】${sizeLabelZh(record.params.size)}`);
    if (record.prompt) parts.push(`【当时的提示词】${record.prompt}`);
    if (record.negative) parts.push(`【当时的负向词】${record.negative}`);
  }
  parts.push(`【目标风格】${input.style?.trim() || "不限定，按画面/已有信息自行判断"}`);
  parts.push(`【输出语言】正向与负向提示词使用${input.language === "zh" ? "中文" : "英文"}`);
  parts.push("【现在开始】只返回约定的 JSON 对象。");
  return parts.join("\n");
}

/** 反推的公共请求体：有图走多模态，无图走参数复盘 */
async function runReverse(config: LlmConfig, input: ReverseInput): Promise<EnhanceResult> {
  const images = (input.images ?? []).slice(0, MAX_VISION_IMAGES);
  const text = buildReverseUserMessage(input, images.length);
  const userContent: string | ChatContentPart[] = images.length
    ? [{ type: "text", text }, ...images.map((url): ChatContentPart => ({ type: "image_url", image_url: { url } }))]
    : text;

  const content = await chatCompletion(
    config,
    [
      { role: "system", content: images.length ? REVERSE_IMAGE_SYSTEM_PROMPT : REVERSE_RECORD_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    {
      json: config.jsonMode,
      disableThinking: config.disableThinking,
      temperature: 0.6,
      maxTokens: Math.max(config.maxTokens, 1400),
      label: images.length ? `提示词反推 · 看图写词（${images.length} 张）` : "提示词反推 · 参数复盘",
    },
  );

  const parsed = parseJsonLoose<unknown>(content);
  const fallbackPrompt = images.length ? "" : (input.record?.prompt ?? "");
  const fallbackNegative = input.record?.negative ?? "";

  if (!parsed) {
    // 模型没按 JSON 返回时退化为纯文本；仍拿不到内容就明确报错，不要给出空结果
    const prompt = sanitizePlainPrompt(content) || fallbackPrompt;
    if (!prompt) throw new ApiError("模型未返回可用的提示词，请重试或更换模型");
    return {
      prompt,
      negative: fallbackNegative,
      structured: { ...EMPTY_STRUCTURED },
      notes: ["模型未返回结构化数据，已直接采用文本结果"],
    };
  }

  const result = normalizeResult(parsed, fallbackPrompt, fallbackNegative);
  if (!result.prompt.trim()) throw new ApiError("模型未返回可用的提示词，请重试或更换模型");
  return result;
}

/**
 * 看图写词：以图片为唯一依据反推提示词（多模态）。
 * 图片已是 data URL，由调用方经 `toVisionDataUrl` 预处理。
 */
export async function describeImages(
  config: LlmConfig,
  images: string[],
  options: { style?: string; language?: "en" | "zh" } = {},
): Promise<EnhanceResult> {
  if (!images.length) throw new ApiError("没有可用于反推的图片");
  return runReverse(config, { images, style: options.style, language: options.language });
}

/** 无图时的参数复盘：按历史记录里的参数与提示词反推（返回结构与其他增强一致） */
export async function describeRecord(config: LlmConfig, record: HistoryRecord): Promise<EnhanceResult> {
  return runReverse(config, { record });
}

export const STYLE_PRESETS = [
  { label: "写实摄影", value: "photorealistic photography, natural skin texture, realistic lighting" },
  { label: "电影感", value: "cinematic still, anamorphic lens, dramatic lighting, film grain, teal and orange" },
  { label: "动漫插画", value: "anime illustration, clean line art, vivid cel shading, expressive eyes" },
  { label: "赛博朋克", value: "cyberpunk, neon lights, rainy night city, holographic reflections, high contrast" },
  { label: "水彩手绘", value: "watercolor painting, soft washes, visible paper texture, delicate brush strokes" },
  { label: "3D 渲染", value: "3d render, octane render, subsurface scattering, soft studio lighting, highly detailed" },
  { label: "极简产品", value: "minimalist product photography, seamless background, soft gradient light, commercial quality" },
  { label: "蒸汽波", value: "vaporwave aesthetic, pastel neon gradients, retro grid, chrome typography" },
] as const;

export { EMPTY_STRUCTURED };

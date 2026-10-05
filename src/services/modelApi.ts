/* ==========================================================================
   生图模型 API
   OpenAI Images 协议：POST /v1/images/generations、POST /v1/images/edits
   ========================================================================== */

import { AUTO_SIZE, type GeneratedImage, type ImageQuality, type ModelApiConfig } from "../types";
import { ApiError, postMultipartJson, requestJson } from "../platform/http";
import { persistBase64, persistRemote } from "../platform/media";
import { extFromBase64, extFromContentType } from "../platform/media";

export interface GenerationRequest {
  prompt: string;
  model: string;
  n: number;
  size: string;
  quality?: ImageQuality;
  /** 负向提示词以约束语句追加（该协议无独立字段） */
  negative?: string;
  responseFormat?: "url" | "b64_json";
}

export interface EditRequest extends GenerationRequest {
  images: Array<{ fileName: string; mime: string; dataBase64: string }>;
}

export interface GenerationResult {
  images: GeneratedImage[];
  revisedPrompts: string[];
  usage?: Record<string, unknown>;
}

interface RawImageItem {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
}

interface RawGenerationResponse {
  created?: number;
  data?: RawImageItem[];
  usage?: Record<string, unknown>;
}

function normalizeBase(baseUrl: string): string {
  const base = (baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) throw new ApiError("未配置生图模型 Base URL");
  return base;
}

/** 拼接端点，兼容用户直接填写完整地址的情况 */
function endpoint(baseUrl: string, path: string): string {
  const base = normalizeBase(baseUrl);
  if (base.endsWith(path)) return base;
  if (/\/v\d+$/.test(base)) return `${base}${path}`;
  if (/\/(images|chat|completions)/.test(base)) return base;
  return `${base}/v1${path}`;
}

/** 无独立 negative 字段，用英文约束句追加 */
export function composePrompt(prompt: string, negative?: string): string {
  const clean = (p: string) => p.trim();
  if (!negative || !clean(negative)) return clean(prompt);
  return `${clean(prompt)}\n\nAvoid the following elements: ${clean(negative)}`;
}

async function materialize(items: RawImageItem[]): Promise<{ images: GeneratedImage[]; revisedPrompts: string[] }> {
  const images: GeneratedImage[] = [];
  const revisedPrompts: string[] = [];

  for (const item of items) {
    const base64 = item.b64_json?.trim();
    if (base64) {
      // 接口直接返回 base64：按真实文件头判断格式，再解码还原成图片落盘
      images.push(await persistBase64(base64, extFromBase64(base64)));
    } else if (item.url) {
      images.push(await persistRemote(item.url));
    } else {
      continue;
    }
    if (item.revised_prompt) revisedPrompts.push(item.revised_prompt);
  }

  if (!images.length) {
    throw new ApiError(
      "接口未返回任何图片数据：请确认「返回格式」与实际响应一致——base64 会放在 data[].b64_json，链接会放在 data[].url",
    );
  }
  return { images, revisedPrompts };
}

/** 工作台统一跟随设置页配置的返回格式，缺省为 base64 */
function resolveResponseFormat(
  config: ModelApiConfig,
  override?: GenerationRequest["responseFormat"],
): string {
  return override ?? config.responseFormat ?? "b64_json";
}

/**
 * 「自动尺寸」的两种发法。
 * 协议里 size 是可选项，取值也可以是 "auto"：先按 "auto" 发，
 * 上游若不认（部分中转只接受具体像素）再整个省掉，交给服务端默认值。
 * 返回 null 表示「不带 size 字段」。
 */
function sizeVariants(size: string): Array<string | null> {
  return size === AUTO_SIZE ? [AUTO_SIZE, null] : [size];
}

/** 判断失败是不是「这个 size 我不认」，只有这种情况才值得换个发法重试 */
function isSizeRejection(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (![400, 422, 500].includes(err.status)) return false;
  return /size|尺寸|dimension|resolution|画幅|aspect/i.test(`${err.message} ${err.detail}`);
}

/** 文生图 */
export async function generateImages(
  config: ModelApiConfig,
  request: GenerationRequest,
): Promise<GenerationResult> {
  let lastError: unknown;
  const variants = sizeVariants(request.size);

  for (const size of variants) {
    const payload: Record<string, unknown> = {
      model: request.model,
      prompt: composePrompt(request.prompt, request.negative),
      n: request.n,
      quality: request.quality ?? config.quality,
      response_format: resolveResponseFormat(config, request.responseFormat),
    };
    if (size) payload.size = size;

    try {
      const raw = await requestJson<RawGenerationResponse>({
        method: "POST",
        url: endpoint(config.baseUrl, "/images/generations"),
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: payload,
        timeoutMs: (config.timeoutSec || 300) * 1000,
        label: size ? `文生图 · /v1/images/generations (size=${size})` : "文生图 · /v1/images/generations",
      });

      const { images, revisedPrompts } = await materialize(raw.data ?? []);
      return { images, revisedPrompts, usage: raw.usage };
    } catch (err) {
      lastError = err;
      // 只剩最后一种发法、或失败与尺寸无关 → 直接抛，不要掩盖真实错误
      if (!size || !isSizeRejection(err)) throw err;
    }
  }

  throw lastError;
}

/** 图生图 / 图片编辑 */
export async function editImages(config: ModelApiConfig, request: EditRequest): Promise<GenerationResult> {
  if (!request.images.length) throw new ApiError("请先上传参考图片");

  const multiple = request.images.length > 1;
  const baseFields = [
    ...request.images.map((image) => ({
      name: multiple ? "image[]" : "image",
      fileName: image.fileName,
      mime: image.mime,
      dataBase64: image.dataBase64,
    })),
    { name: "prompt", value: composePrompt(request.prompt, request.negative) },
    { name: "model", value: request.model },
    { name: "n", value: String(request.n) },
    { name: "response_format", value: resolveResponseFormat(config, request.responseFormat) },
  ];

  let lastError: unknown;
  for (const size of sizeVariants(request.size)) {
    try {
      const raw = await postMultipartJson<RawGenerationResponse>({
        url: endpoint(config.baseUrl, "/images/edits"),
        headers: { Authorization: `Bearer ${config.apiKey}` },
        fields: size ? [...baseFields, { name: "size", value: size }] : baseFields,
        timeoutMs: (config.timeoutSec || 300) * 1000,
        label: size ? `图生图 · /v1/images/edits (size=${size})` : "图生图 · /v1/images/edits",
      });

      const { images, revisedPrompts } = await materialize(raw.data ?? []);
      return { images, revisedPrompts, usage: raw.usage };
    } catch (err) {
      lastError = err;
      if (!size || !isSizeRejection(err)) throw err;
    }
  }

  throw lastError;
}

/** 连通性自检：用一条极短请求验证 Key / Base URL / 模型名 */
export async function testModelApi(config: ModelApiConfig): Promise<string> {
  const raw = await requestJson<RawGenerationResponse>({
    method: "POST",
    url: endpoint(config.baseUrl, "/images/generations"),
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: {
      model: config.model,
      prompt: "a tiny red dot on white background",
      n: 1,
      size: "1024x1024",
      quality: "low",
      // 连通测试也走配置的返回格式，避免「测试通过但真实调用失败」
      response_format: resolveResponseFormat(config),
    },
    timeoutMs: Math.min((config.timeoutSec || 300), 120) * 1000,
    label: "连通测试 · 生图模型",
  });
  const count = raw.data?.length ?? 0;
  if (!count) throw new ApiError("接口连通但未返回图片");
  return `连通正常，返回 ${count} 张图片`;
}

export { extFromContentType };

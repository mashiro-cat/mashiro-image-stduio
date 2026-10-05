/* ==========================================================================
   LLM API（openai-completions 协议）
   POST {baseUrl}/chat/completions

   与上游打交道时踩过的坑，都在这里兜住：
   1. 多模态模型默认「先思考再回答」，正文可能整段落在 reasoning_content 里
      → 默认发送 enable_thinking:false；取不到正文时回落到 reasoning_content。
   2. 部分中转 / 多模态模型不认 response_format:{json_object}，也不认
      enable_thinking，甚至不认 max_tokens（只收 max_completion_tokens）
      → 按错误信息逐个去掉或替换成兼容写法重试，而不是直接失败。
   ========================================================================== */

import type { LlmConfig } from "../types";
import { ApiError, requestJson } from "../platform/http";

/* ------------------------------------------------------------ 消息结构 */

export interface ChatTextPart {
  type: "text";
  text: string;
}

/** 视觉输入：url 既可以是 http(s) 链接，也可以是 data:image/...;base64,xxx */
export interface ChatImagePart {
  type: "image_url";
  image_url: { url: string };
}

export type ChatContentPart = ChatTextPart | ChatImagePart;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  /** 纯文本直接给字符串；带图片时必须给 content 数组 */
  content: string | ChatContentPart[];
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  /** 要求模型返回 JSON 对象 */
  json?: boolean;
  /** 关闭思考模式（不传则跟随配置） */
  disableThinking?: boolean;
  timeoutMs?: number;
  /** 日志中展示的业务来源 */
  label?: string;
}

interface RawChatMessage {
  content?: string | null;
  reasoning_content?: string | null;
}

interface RawChatResponse {
  choices?: Array<{ message?: RawChatMessage; finish_reason?: string }>;
  error?: { message?: string };
}

/* ------------------------------------------------------------ 端点 */

export function chatEndpoint(baseUrl: string): string {
  const base = (baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) throw new ApiError("未配置 LLM Base URL");
  if (base.endsWith("/chat/completions")) return base;
  if (/\/v\d+$/.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

/** 模型偶尔会把 JSON 写在 ``` 里，或先来一句「好的」——统一兜一下 */
function extractMessageText(message: RawChatMessage | undefined): string {
  const content = typeof message?.content === "string" ? message.content.trim() : "";
  if (content) return content;
  const reasoning = typeof message?.reasoning_content === "string" ? message.reasoning_content.trim() : "";
  return reasoning;
}

/* ------------------------------------------------------------ 参数降级 */

interface BodyFlags {
  json: boolean;
  thinking: boolean;
  /** 新一代 OpenAI 模型移除 max_tokens，改用 max_completion_tokens */
  tokenParam: "max_tokens" | "max_completion_tokens";
}

/**
 * 上游报「这个参数我不认」时，把它从请求体里摘掉再做一次。
 * 只处理 400/422 这类参数级错误，5xx / 网络错误照常抛出。
 */
function relaxRejectedField(err: ApiError, flags: BodyFlags): boolean {
  if (![400, 422].includes(err.status)) return false;
  const text = `${err.message} ${err.detail}`.toLowerCase();

  if (flags.tokenParam === "max_tokens" && /max_tokens|max_completion_tokens/.test(text)) {
    flags.tokenParam = "max_completion_tokens";
    return true;
  }
  if (flags.json && /response_format|json_object|json mode|json_schema|json schema/.test(text)) {
    flags.json = false;
    return true;
  }
  if (flags.thinking && /enable_thinking|thinking|chat_template_kwargs|extra_body|reasoning/.test(text)) {
    flags.thinking = false;
    return true;
  }
  // 兜底：上游只说「多余 / 未知的字段」，最可能是我们多带的开关
  if (flags.thinking && /(unknown|unrecognized|unsupported|invalid|extra)[^.]{0,24}(param|parameter|argument|field|key)|参数|字段/.test(text)) {
    flags.thinking = false;
    return true;
  }
  return false;
}

/* ------------------------------------------------------------ 调用 */

export async function chatCompletion(
  config: LlmConfig,
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<string> {
  if (!config.apiKey) throw new ApiError("未配置 LLM API Key");
  if (!config.model) throw new ApiError("未配置 LLM 模型名称");

  const flags: BodyFlags = {
    json: options.json ?? false,
    thinking: options.disableThinking ?? config.disableThinking ?? true,
    tokenParam: "max_tokens",
  };
  const temperature = options.temperature ?? config.temperature;
  const maxTokens = options.maxTokens ?? config.maxTokens;
  const url = chatEndpoint(config.baseUrl);
  const timeoutMs = options.timeoutMs ?? (config.timeoutSec || 120) * 1000;
  const label = options.label ?? "LLM · /v1/chat/completions";

  const buildBody = (): Record<string, unknown> => {
    const body: Record<string, unknown> = {
      model: config.model,
      messages,
      temperature,
      stream: false,
      [flags.tokenParam]: maxTokens,
    };
    // JSON 模式与思考模式都按需携带，被上游拒绝后由 relaxRejectedField 摘掉
    if (flags.json) body.response_format = { type: "json_object" };
    if (flags.thinking) body.enable_thinking = false;
    return body;
  };

  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const raw = await requestJson<RawChatResponse>({
        method: "POST",
        url,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: buildBody(),
        timeoutMs,
        label,
      });

      const text = extractMessageText(raw.choices?.[0]?.message);
      if (text) return text;

      const finish = raw.choices?.[0]?.finish_reason;
      throw new ApiError(
        finish === "length"
          ? "模型输出被截断（finish_reason=length）：请调大「最大输出 token」"
          : "模型未返回有效内容：请确认模型名是否正确，或关闭「思考模式」后重试",
      );
    } catch (err) {
      lastError = err;
      if (!(err instanceof ApiError)) throw err;
      if (!relaxRejectedField(err, flags)) throw err;
    }
  }
  throw lastError;
}

/** 拉取可用模型列表（兼容部分服务未开放该接口的情况） */
export async function listModels(config: LlmConfig): Promise<string[]> {
  const base = (config.baseUrl || "").trim().replace(/\/+$/, "");
  const url = /\/v\d+$/.test(base) ? `${base}/models` : `${base}/v1/models`;
  const raw = await requestJson<{ data?: Array<{ id?: string }> }>({
    method: "GET",
    url,
    headers: { Authorization: `Bearer ${config.apiKey}` },
    timeoutMs: 30_000,
    label: "LLM · 模型列表",
  });
  return (raw.data ?? []).map((item) => item.id).filter((id): id is string => Boolean(id));
}

/** 连通性自检：真实带一次视觉调用代价太高，这里只验证文本链路与开关是否被接受 */
export async function testLlm(config: LlmConfig): Promise<string> {
  const reply = await chatCompletion(
    config,
    [{ role: "user", content: "回复两个字：连通" }],
    { maxTokens: 64, temperature: 0, disableThinking: config.disableThinking, timeoutMs: 60_000, label: "LLM · 连通测试" },
  );
  return `连通正常，模型回复：${reply.slice(0, 40)}`;
}

/** 从模型输出中稳健地提取 JSON（容忍 ```json 包裹与前后缀文本） */
export function parseJsonLoose<T>(text: string): T | null {
  const trimmed = text.trim();
  const candidates: string[] = [trimmed];

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      /* 继续尝试 */
    }
  }
  return null;
}

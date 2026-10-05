/* ==========================================================================
   统一请求层
   桌面端 → Rust 侧 reqwest（无 CORS / 可自定义超时 / 密钥不出现在页面网络层）
   浏览器预览 → 原生 fetch（仅演示模式使用）

   所有请求都会经过调试日志上报：
   - 调试模式关闭时：只记录 方法 / 精简 URL / 状态码 / 耗时（便于事后回溯失败）
   - 调试模式开启时：额外记录 请求头 / 请求体 / 响应头 / 响应体（密钥自动脱敏）
   ========================================================================== */

import type { DebugLogEntry } from "../types";
import { invoke, isTauri, uid } from "./env";
import {
  debugRuntime,
  inferSource,
  isDebugEnabled,
  pushDebugLog,
  sanitizeBody,
  sanitizeHeaders,
  summarizeMultipart,
  summarizeUrl,
} from "./debug";

export class ApiError extends Error {
  status: number;
  detail: string;
  /** 针对常见错误码给出的排查建议 */
  hint: string;

  constructor(message: string, status = 0, detail = "", hint = "") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.hint = hint || describeHttpStatus(status, detail);
  }
}

export interface ResponseHeader {
  name: string;
  value: string;
}

export interface RawResponse {
  status: number;
  ok: boolean;
  headers?: ResponseHeader[];
  body: string;
  isBase64: boolean;
}

interface RequestOptions {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  /** 对象自动 JSON 序列化；字符串按原样发送 */
  body?: unknown;
  timeoutMs?: number;
  /** 日志里展示的业务来源，例如「文生图 · generations」 */
  label?: string;
  /**
   * 轮询类请求：调试模式开启时逐条记录，关闭时只在失败时记录，
   * 避免高频轮询把日志刷满
   */
  quiet?: boolean;
}

/* ------------------------------------------------------------ 错误提示 */

/** 常见网关 / 鉴权错误的人话解释，直接用于排错 */
export function describeHttpStatus(status: number, body = ""): string {
  const cloudflare = /cloudflare|cf-ray|error code: 5\d\d/i.test(body) || /<!DOCTYPE html/i.test(body);
  switch (status) {
    case 524:
      return "上游网关等待超时（Cloudflare 524）：网关在约 100 秒内没等到源站响应就把连接切断了。服务端可能仍在继续生成，但本次结果已经取不到——可尝试降低尺寸 / 画质、把生成数量改为 1，或稍后在历史记录与上游控制台确认结果。";
    case 522:
    case 523:
      return "上游网关无法连接源站（Cloudflare 522/523），通常是服务端临时不可用，请稍后重试。";
    case 504:
      return "网关超时（HTTP 504），上游处理时间过长，请稍后重试或降低单次生成规模。";
    case 502:
    case 503:
      return "上游服务暂时不可用（HTTP 502/503），请稍后重试。";
    case 401:
      return "鉴权失败（HTTP 401）：请到「设置页」检查对应的 API Key 是否正确、是否已过期。";
    case 403:
      return "无权访问（HTTP 403）：密钥有效但被拒绝，请确认账号权限或是否绑定了来源限制。";
    case 404:
      return "接口不存在（HTTP 404）：请检查 Base URL 是否填成了具体接口地址，或多带了路径。";
    case 413:
      return "请求体过大（HTTP 413）：参考图或生成尺寸过大，建议压缩图片后重试。";
    case 429:
      return "请求过于频繁（HTTP 429）：触发了限流，请降低并发或稍后重试。";
    case 400:
      return "参数不被接受（HTTP 400）：请对照接口文档检查模型名、尺寸、画质等参数。";
    case 0:
      return "";
    default:
      if (status >= 500) return `服务端错误（HTTP ${status}）${cloudflare ? "，响应来自网关，可展开响应体查看 cf-ray 等信息" : ""}，请稍后重试。`;
      return "";
  }
}

/** 请求失败时把响应体里的错误信息尽量提取出来 */
function extractMessage(status: number, body: string): string {
  if (!body) return `请求失败（HTTP ${status}）`;
  try {
    const parsed = JSON.parse(body);
    const msg =
      parsed?.error?.message ??
      parsed?.message ??
      parsed?.msg ??
      parsed?.error ??
      parsed?.detail;
    if (typeof msg === "string" && msg.trim()) return msg.trim();
    if (parsed?.data && typeof parsed.data === "string") return parsed.data;
  } catch {
    /* 非 JSON：可能是网关返回的 HTML 错误页，提取标题 */
    const title = /<title>([^<]{0,200})<\/title>/i.exec(body)?.[1]?.trim();
    if (title) return `${title}（HTTP ${status}）`;
  }
  return body.slice(0, 400);
}

/* ------------------------------------------------------------ 日志 */

function toHeaderRecord(headers: ResponseHeader[] | undefined): Record<string, string> | undefined {
  if (!headers?.length) return undefined;
  const out: Record<string, string> = {};
  for (const item of headers) {
    // set-cookie 之类重复头合并展示即可
    out[item.name] = out[item.name] ? `${out[item.name]}, ${item.value}` : item.value;
  }
  return out;
}

interface LogInput {
  label?: string;
  method: string;
  url: string;
  timeoutMs?: number;
  durationMs: number;
  status: number;
  ok: boolean;
  requestHeaders?: Record<string, string>;
  requestBody?: string;
  responseHeaders?: ResponseHeader[];
  responseBody?: string;
  error?: string;
  truncated?: boolean;
}

function record(input: LogInput) {
  const runtime = debugRuntime();
  const verbose = runtime.enabled;
  const entry: DebugLogEntry = {
    id: uid("log"),
    at: Date.now(),
    source: input.label || inferSource(input.url),
    method: input.method,
    url: summarizeUrl(input.url, verbose),
    status: input.status,
    ok: input.ok,
    durationMs: Math.round(input.durationMs),
    timeoutMs: input.timeoutMs,
    verbose,
  };

  if (input.error) entry.error = input.error;
  const hint = describeHttpStatus(input.status, input.responseBody ?? "");
  if (hint) entry.hint = hint;

  if (verbose) {
    if (runtime.captureHeaders && input.requestHeaders) entry.requestHeaders = sanitizeHeaders(input.requestHeaders);
    if (runtime.captureBody && input.requestBody) {
      const sanitized = sanitizeBody(input.requestBody);
      entry.requestBody = sanitized.body;
      entry.truncated = sanitized.truncated;
    }
    if (runtime.captureHeaders) entry.responseHeaders = toHeaderRecord(input.responseHeaders);
    if (runtime.captureBody && input.responseBody) {
      const sanitized = sanitizeBody(input.responseBody);
      entry.responseBody = sanitized.body;
      entry.truncated = entry.truncated || sanitized.truncated;
    }
  }

  pushDebugLog(entry);
}

/** 统一执行并记录一次请求 */
async function runLogged(
  meta: {
    label?: string;
    method: string;
    url: string;
    timeoutMs?: number;
    requestHeaders?: Record<string, string>;
    requestBody?: string;
    quiet?: boolean;
  },
  executor: () => Promise<RawResponse>,
): Promise<RawResponse> {
  const startedAt = performance.now();
  try {
    const res = await executor();
    if (!(meta.quiet && !isDebugEnabled())) {
      record({
        ...meta,
        durationMs: performance.now() - startedAt,
        status: res.status,
        ok: res.ok,
        responseHeaders: res.headers,
        responseBody: res.body,
      });
    }
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    record({
      ...meta,
      durationMs: performance.now() - startedAt,
      status: 0,
      ok: false,
      error: message,
    });
    throw err;
  }
}

/* ------------------------------------------------------------ 请求 */

export async function requestRaw(options: RequestOptions): Promise<RawResponse> {
  const method = (options.method ?? "POST").toUpperCase();
  const headers = { ...(options.headers ?? {}) };
  let body: string | undefined;
  let bodyBase64: string | undefined;

  if (typeof options.body === "string") {
    body = options.body;
  } else if (options.body instanceof Uint8Array) {
    bodyBase64 = bytesToBase64(options.body);
  } else if (options.body !== undefined && options.body !== null) {
    body = JSON.stringify(options.body);
    if (!headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/json";
    }
  }

  const requestBody = bodyBase64 ? `<二进制请求体 ${Math.round((bodyBase64.length * 3) / 4)} 字节>` : body;

  return runLogged(
    {
      label: options.label,
      method,
      url: options.url,
      timeoutMs: options.timeoutMs,
      requestHeaders: headers,
      requestBody,
      quiet: options.quiet,
    },
    async () => {
      if (isTauri()) {
        return invoke<RawResponse>("http_request", {
          args: {
            method,
            url: options.url,
            headers: toHeaderList(headers),
            body,
            bodyBase64,
            timeoutMs: options.timeoutMs,
          },
        });
      }

      // 浏览器预览
      const res = await fetch(options.url, {
        method,
        headers,
        body: bodyBase64 ? (base64ToBytes(bodyBase64) as unknown as BodyInit) : body,
      });
      const arrayBuffer = await res.arrayBuffer();
      const contentType = res.headers.get("content-type") ?? "";
      const textual = /json|text|xml|javascript|html|urlencoded/i.test(contentType) || !contentType;
      return {
        status: res.status,
        ok: res.ok,
        headers: toHeaderList(Object.fromEntries(res.headers.entries())),
        body: textual ? new TextDecoder().decode(arrayBuffer) : bytesToBase64(new Uint8Array(arrayBuffer)),
        isBase64: !textual,
      };
    },
  );
}

/** 解析 JSON 响应，非 2xx 或 code!=0 时抛 ApiError */
export async function requestJson<T>(options: RequestOptions): Promise<T> {
  const res = await requestRaw(options);
  if (!res.ok) {
    throw new ApiError(extractMessage(res.status, res.body), res.status, res.body);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(res.body);
  } catch {
    throw new ApiError(`响应不是合法 JSON：${res.body.slice(0, 200)}`, res.status, res.body);
  }
  const record = payload as Record<string, unknown>;
  // RunningHub 风格 { code, msg, data }
  if (typeof record?.code === "number" && record.code !== 0) {
    throw new ApiError(
      typeof record.msg === "string" && record.msg ? record.msg : `接口返回错误码 ${record.code}`,
      res.status,
      res.body,
    );
  }
  return payload as T;
}

/** 是否为调试模式（供业务层决定是否提示「查看日志」） */
export { isDebugEnabled };

/** multipart/form-data 上传 */
export async function postMultipart(options: {
  url: string;
  fields: Array<{ name: string; value?: string; fileName?: string; mime?: string; dataBase64?: string }>;
  headers?: Record<string, string>;
  timeoutMs?: number;
  label?: string;
  quiet?: boolean;
}): Promise<RawResponse> {
  const headers = { ...(options.headers ?? {}) };
  const summary = summarizeMultipart(options.fields);

  return runLogged(
    {
      label: options.label,
      method: "POST",
      url: options.url,
      timeoutMs: options.timeoutMs,
      requestHeaders: headers,
      requestBody: summary.body,
      quiet: options.quiet,
    },
    async () => {
      if (isTauri()) {
        return invoke<RawResponse>("http_multipart", {
          args: {
            url: options.url,
            headers: toHeaderList(headers),
            fields: options.fields,
            timeoutMs: options.timeoutMs,
          },
        });
      }

      const form = new FormData();
      for (const field of options.fields) {
        if (field.dataBase64) {
          const blob = base64ToBlob(field.dataBase64, field.mime ?? "application/octet-stream");
          form.append(field.name, blob, field.fileName ?? "file");
        } else if (field.value !== undefined) {
          form.append(field.name, field.value);
        }
      }
      const res = await fetch(options.url, { method: "POST", headers, body: form });
      const text = await res.text();
      return {
        status: res.status,
        ok: res.ok,
        headers: toHeaderList(Object.fromEntries(res.headers.entries())),
        body: text,
        isBase64: false,
      };
    },
  );
}

export async function postMultipartJson<T>(options: Parameters<typeof postMultipart>[0]): Promise<T> {
  const res = await postMultipart(options);
  if (!res.ok) throw new ApiError(extractMessage(res.status, res.body), res.status, res.body);
  let payload: unknown;
  try {
    payload = JSON.parse(res.body);
  } catch {
    throw new ApiError(`响应不是合法 JSON：${res.body.slice(0, 200)}`, res.status, res.body);
  }
  const record = payload as Record<string, unknown>;
  if (typeof record?.code === "number" && record.code !== 0) {
    throw new ApiError(
      typeof record.message === "string"
        ? record.message
        : typeof record.msg === "string"
          ? record.msg
          : `接口返回错误码 ${record.code}`,
      res.status,
      res.body,
    );
  }
  return payload as T;
}

function toHeaderList(headers: Record<string, string>): ResponseHeader[] {
  return Object.entries(headers).map(([name, value]) => ({ name, value }));
}

/* ------------------------------------------------------------ 编解码 */

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64_CHARS[b0 >> 2];
    out += B64_CHARS[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? "=" : B64_CHARS[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? "=" : B64_CHARS[b2 & 63];
  }
  return out;
}

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/\s/g, "").replace(/^data:[^,]+,/, "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const length = (clean.length / 4) * 3 - padding;
  const bytes = new Uint8Array(length);
  const lookup = new Int16Array(256).fill(-1);
  for (let i = 0; i < B64_CHARS.length; i += 1) lookup[B64_CHARS.charCodeAt(i)] = i;

  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const e0 = lookup[clean.charCodeAt(i)];
    const e1 = lookup[clean.charCodeAt(i + 1)];
    const e2 = lookup[clean.charCodeAt(i + 2)];
    const e3 = lookup[clean.charCodeAt(i + 3)];
    if (p < length) bytes[p++] = (e0 << 2) | (e1 >> 4);
    if (p < length && e2 >= 0) bytes[p++] = ((e1 & 15) << 4) | (e2 >> 2);
    if (p < length && e3 >= 0) bytes[p++] = ((e2 & 3) << 6) | e3;
  }
  return bytes;
}

export function base64ToBlob(base64: string, mime = "image/png"): Blob {
  return new Blob([base64ToBytes(base64) as unknown as BlobPart], { type: mime });
}

export function dataUrlToBase64(dataUrl: string): string {
  return dataUrl.replace(/^data:[^,]+,/, "");
}

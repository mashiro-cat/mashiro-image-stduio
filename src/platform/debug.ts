/* ==========================================================================
   调试日志基础设施
   平台层（http.ts）通过这里上报请求日志，不直接依赖 Pinia，
   由 stores/debugLog.ts 在启动时注入 sink 完成落库与展示。
   ========================================================================== */

import type { DebugLogEntry } from "../types";

export interface DebugRuntime {
  enabled: boolean;
  captureBody: boolean;
  captureHeaders: boolean;
  maxEntries: number;
}

export interface DebugSink {
  push: (entry: DebugLogEntry) => void;
}

let runtime: DebugRuntime = {
  enabled: false,
  captureBody: true,
  captureHeaders: true,
  maxEntries: 120,
};

let sink: DebugSink | null = null;

export function setDebugSink(next: DebugSink | null) {
  sink = next;
}

export function configureDebug(next: Partial<DebugRuntime>) {
  runtime = { ...runtime, ...next };
}

export function debugRuntime(): DebugRuntime {
  return runtime;
}

export const isDebugEnabled = () => runtime.enabled;

/** 上报一条日志；关闭调试时仍保留精简记录（便于事后回溯失败原因） */
export function pushDebugLog(entry: DebugLogEntry) {
  if (!sink) return;
  try {
    sink.push(entry);
  } catch {
    /* 日志本身不应影响主流程 */
  }
}

/* ------------------------------------------------------------ URL */

/** 精简 URL：非调试模式下去掉 query，避免把签名参数写进日志 */
export function summarizeUrl(url: string, keepQuery: boolean): string {
  const trimmed = url.length > 400 ? `${url.slice(0, 400)}…` : url;
  if (keepQuery) return trimmed;
  const index = trimmed.indexOf("?");
  return index === -1 ? trimmed : `${trimmed.slice(0, index)}?<已省略>`;
}

/** 从 URL 推断业务来源，作为未显式标注时的兜底 */
export function inferSource(url: string): string {
  try {
    const path = new URL(url).pathname;
    return path || url;
  } catch {
    return url;
  }
}

/* ------------------------------------------------------------ 脱敏 */

const SECRET_KEY = /^(api_?key|key|token|access_?token|secret|password|access_?password|authorization)$/i;
const SECRET_HEADER = /authorization|api[-_]?key|cookie|token|secret/i;
const LONG_BASE64 = /^[A-Za-z0-9+/=]{240,}$/;
const DATA_URL = /^data:[^;,]+;base64,/i;

/** 保留少量前后缀，便于确认用的是哪把 Key，又不至于泄露 */
export function maskSecret(value: string): string {
  const text = String(value ?? "");
  if (!text) return "";
  const bearer = /^(bearer\s+)(.+)$/i.exec(text);
  const prefix = bearer ? bearer[1] : "";
  const token = bearer ? bearer[2] : text;
  if (token.length <= 10) return `${prefix}***`;
  return `${prefix}${token.slice(0, 6)}***${token.slice(-4)}`;
}

export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = SECRET_HEADER.test(name) ? maskSecret(value) : value.length > 300 ? `${value.slice(0, 300)}…` : value;
  }
  return out;
}

/** 递归脱敏并省略超长 base64 */
function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6) return "<层级过深已省略>";
  if (typeof value === "string") {
    if (DATA_URL.test(value)) {
      const mime = value.slice(5, value.indexOf(";"));
      return `data:${mime};base64,<${value.length} 字符已省略>`;
    }
    if (LONG_BASE64.test(value)) return `<base64 ${value.length} 字符已省略>`;
    return value.length > 2000 ? `${value.slice(0, 2000)}…<共 ${value.length} 字符>` : value;
  }
  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(key)) {
        out[key] = typeof item === "string" ? maskSecret(item) : "<已脱敏>";
      } else {
        out[key] = scrub(item, depth + 1);
      }
    }
    return out;
  }
  return value;
}

/**
 * 处理请求体文本：JSON 走结构脱敏，其余做字符串级替换。
 * 返回是否发生了截断。
 */
export function sanitizeBody(text: string, maxLength = 6000): { body: string; truncated: boolean } {
  if (!text) return { body: "", truncated: false };

  let output: string;
  try {
    output = JSON.stringify(scrub(JSON.parse(text)), null, 2);
  } catch {
    output = text
      .replace(/"?(api_?key|token|secret|password)"?\s*[:=]\s*"?([^",\s}]+)"?/gi, (_m, key, value) => `${key}: ${maskSecret(String(value))}`)
      .replace(/data:[^;,]+;base64,[A-Za-z0-9+/=]+/gi, (m) => `data:${m.slice(5, m.indexOf(";"))};base64,<${m.length} 字符已省略>`);
  }

  if (output.length > maxLength) {
    return { body: `${output.slice(0, maxLength)}\n…<已截断，共 ${output.length} 字符>`, truncated: true };
  }
  return { body: output, truncated: false };
}

/** multipart 请求体摘要：文本字段直接展示，文件字段只记录元信息 */
export function summarizeMultipart(
  fields: Array<{ name: string; value?: string; fileName?: string; mime?: string; dataBase64?: string }>,
): { body: string; truncated: boolean } {
  const summary = fields.map((field) => {
    if (field.dataBase64) {
      return {
        name: field.name,
        fileName: field.fileName ?? "file",
        mime: field.mime ?? "application/octet-stream",
        bytes: Math.round((field.dataBase64.length * 3) / 4),
        content: "<二进制内容已省略，可查看本地文件>",
      };
    }
    return { name: field.name, value: field.value ?? "" };
  });
  return sanitizeBody(JSON.stringify(summary), 4000);
}

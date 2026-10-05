/* ==========================================================================
   持久化层
   桌面端 → 应用数据目录下的 JSON / 图片文件
   浏览器预览 → localStorage（图片以 data URL 内联，仅供体验）

   所有读写失败都会被记录（不再静默吞掉）：
   「写入失败但界面显示成功」会让用户看到「开关打开后自己还原」这类怪现象。
   ========================================================================== */

import { invoke, isTauri } from "./env";

const FILE_PREFIX = "mashiro-studio:";

let cachedRoot: string | null = null;
let lastError = "";

export interface WriteResult {
  ok: boolean;
  error?: string;
}

/** 最近一次存储错误（空字符串表示无错误） */
export function lastStorageError(): string {
  return lastError;
}

export function clearStorageError() {
  lastError = "";
}

function reportError(err: unknown) {
  lastError = err instanceof Error ? err.message : String(err);
}

export async function dataRoot(): Promise<string | null> {
  if (!isTauri()) return null;
  if (cachedRoot) return cachedRoot;
  try {
    cachedRoot = await invoke<string>("app_data_root");
    return cachedRoot;
  } catch (err) {
    reportError(`无法定位应用数据目录：${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * 拼接绝对路径。
 * 必须用数据目录本身的分隔符（Windows 是 `\`）：拼出来的路径会存进历史记录，
 * 之后要交给系统文件管理器定位——Windows 的 `explorer /select,` 只认反斜杠，
 * 路径里混正斜杠会导致定位失效。
 */
function joinPath(root: string, relative: string): string {
  const sep = root.includes("\\") ? "\\" : "/";
  const parts = relative.split(/[\\/]+/).filter(Boolean);
  return [root.replace(/[\\/]+$/, ""), ...parts].join(sep);
}

async function resolve(path: string): Promise<string> {
  const root = await dataRoot();
  if (!root) throw new Error("无法定位应用数据目录");
  return joinPath(root, path);
}

/**
 * 把数据目录内的相对路径拼成绝对路径（不校验是否存在）。
 * 前端拿到 `list_dir` 的文件名后需要还原成完整路径才能删除。
 */
export async function toAbsolutePath(relativePath: string): Promise<string | null> {
  const root = await dataRoot();
  if (!root) return null;
  return joinPath(root, relativePath);
}

/* ------------------------------------------------------------ JSON 存储 */

export async function readJson<T>(key: string, fallback: T): Promise<T> {
  if (!isTauri()) {
    const raw = localStorage.getItem(FILE_PREFIX + key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      reportError(`本地配置 ${key} 解析失败，已回退为默认值`);
      return fallback;
    }
  }
  try {
    const path = await resolve(`store/${key}.json`);
    const text = await invoke<string | null>("read_text", { path });
    if (!text) return fallback;
    return JSON.parse(text) as T;
  } catch (err) {
    reportError(`读取 ${key} 失败：${err instanceof Error ? err.message : String(err)}`);
    return fallback;
  }
}

export async function writeJson(key: string, value: unknown): Promise<WriteResult> {
  const text = JSON.stringify(value, null, 2);

  if (!isTauri()) {
    try {
      localStorage.setItem(FILE_PREFIX + key, text);
      return { ok: true };
    } catch (err) {
      const message = `本地存储写入失败（可能超出容量限制）：${err instanceof Error ? err.message : String(err)}`;
      reportError(message);
      return { ok: false, error: message };
    }
  }

  try {
    const path = await resolve(`store/${key}.json`);
    await invoke("write_text", { path, contents: text });
    return { ok: true };
  } catch (err) {
    const message = `写入 ${key} 失败：${err instanceof Error ? err.message : String(err)}`;
    reportError(message);
    return { ok: false, error: message };
  }
}

/* ------------------------------------------------------------ 文件操作 */

/** 保存二进制内容，返回绝对路径；浏览器预览返回 null */
export async function writeBinary(relativePath: string, base64: string): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const path = await resolve(relativePath);
    return await invoke<string>("write_binary", { path, dataBase64: base64 });
  } catch (err) {
    reportError(`保存图片失败：${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export async function readBinary(path: string): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<string>("read_binary", { path });
  } catch (err) {
    reportError(`读取图片失败：${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** 删除文件或目录 */
export async function deleteFile(path: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("remove_path", { path });
  } catch (err) {
    reportError(`删除文件失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 列出目录下的直接子文件名（不递归）；浏览器预览返回空数组 */
export async function listDir(relativePath: string): Promise<string[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<string[]>("list_dir", { path: await resolve(relativePath) });
  } catch (err) {
    reportError(`读取目录失败：${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/** 导出到系统图片目录 */
export async function exportCopy(path: string, fileName: string): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<string>("export_copy", { source: path, fileName });
  } catch (err) {
    reportError(`导出失败：${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export interface RevealResult {
  ok: boolean;
  /** 失败原因（如「文件不存在：…」），直接展示给用户即可 */
  error?: string;
}

/**
 * 在系统文件管理器中定位文件。
 * 失败时把原因带回去——之前只返回 boolean，界面只能笼统提示「仅桌面端可用」，
 * 真正的原因（文件已被删除 / 打开失败）反而看不出来。
 */
export async function revealInFolder(path: string): Promise<RevealResult> {
  if (!isTauri()) return { ok: false, error: "浏览器预览模式没有本地文件系统" };
  try {
    await invoke("reveal_in_folder", { path });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function removeDataDir(): Promise<void> {
  if (!isTauri()) return;
  const root = await dataRoot();
  if (!root) return;
  try {
    await invoke("remove_path", { path: root });
  } catch {
    /* ignore */
  }
}

export async function revealDataDir(): Promise<RevealResult> {
  const root = await dataRoot();
  if (!root) return { ok: false, error: "无法定位应用数据目录" };
  return revealInFolder(root);
}

/* ------------------------------------------------------------ 自检 */

export interface StorageProbeResult {
  ok: boolean;
  message: string;
  location: string;
}

/**
 * 读写自检：写入一份探针数据再读回比对。
 * 用于快速判定「设置打开后自己还原」是不是落盘问题。
 */
export async function probeStorage(): Promise<StorageProbeResult> {
  clearStorageError();
  const marker = Date.now();
  const result = await writeJson("__probe", { marker });
  const root = await dataRoot();
  const location = isTauri()
    ? root
      ? joinPath(root, "store")
      : "（无法定位应用数据目录）"
    : "浏览器 localStorage";

  if (!result.ok) {
    return { ok: false, message: result.error ?? "写入失败", location };
  }
  const back = await readJson<{ marker?: number }>("__probe", {});
  if (back?.marker !== marker) {
    return {
      ok: false,
      message: `写入成功但读回不一致（期望 ${marker}，实际 ${String(back?.marker)}）`,
      location,
    };
  }
  return { ok: true, message: "读写正常，配置可以正常保存", location };
}

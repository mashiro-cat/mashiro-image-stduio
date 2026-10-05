/* ==========================================================================
   图片资产管理：远端结果落盘、本地文件寻址、尺寸探测
   ========================================================================== */

import type { GeneratedImage } from "../types";
import { fileUrl, invoke, isTauri, uid } from "./env";
import { requestRaw, bytesToBase64, base64ToBytes, dataUrlToBase64 } from "./http";
import { writeBinary, readBinary, deleteFile, exportCopy } from "./storage";

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
};

export function extFromContentType(contentType?: string): string {
  if (!contentType) return "png";
  const key = contentType.split(";")[0].trim().toLowerCase();
  return MIME_EXT[key] ?? "png";
}

/** 真实文件头 → 扩展名，用于 base64 返回时还原正确的图片格式 */
export function extFromBase64(base64: string): string {
  try {
    const clean = base64.replace(/\s/g, "").replace(/^data:[^,]+,/, "");
    if (!clean) return "png";
    const head = clean.slice(0, 24);
    const usable = head.slice(0, head.length - (head.length % 4));
    const bytes = base64ToBytes(usable);
    const at = (i: number) => bytes[i] ?? 0;

    if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "png";
    if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpg";
    if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) return "gif";
    if (at(0) === 0x42 && at(1) === 0x4d) return "bmp";
    // WEBP: RIFF....WEBP
    if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57) return "webp";
    // SVG 是文本，可能被 base64 编码
    const text = new TextDecoder().decode(bytes);
    if (/<svg|<\?xml/i.test(text)) return "svg";
  } catch {
    /* 识别失败按 png 处理 */
  }
  return "png";
}

export function mimeFromPath(path?: string): string {
  const ext = (path ?? "").split(".").pop()?.toLowerCase();
  for (const [mime, e] of Object.entries(MIME_EXT)) {
    if (e === ext) return mime;
  }
  return "image/png";
}

/** 从 base64 落盘 */
export async function persistBase64(base64: string, ext = "png"): Promise<GeneratedImage> {
  const id = uid("img");
  const relative = `images/${id}.${ext}`;
  const path = await writeBinary(relative, dataUrlToBase64(base64));
  if (path) return { id, path };
  // 浏览器预览：内联保存，便于历史记录回看
  return { id, dataUrl: `data:${mimeFromExt(ext)};base64,${dataUrlToBase64(base64)}` };
}

function mimeFromExt(ext: string): string {
  const key = ext.toLowerCase();
  for (const [mime, e] of Object.entries(MIME_EXT)) {
    if (e === key) return mime;
  }
  if (key === "svg") return "image/svg+xml";
  return "image/png";
}

/** 从远端 URL 下载并落盘；失败时退化为保留远端链接 */
export async function persistRemote(url: string): Promise<GeneratedImage> {
  const id = uid("img");
  if (!isTauri()) return { id, url };
  try {
    const res = await requestRaw({ method: "GET", url, timeoutMs: 120_000 });
    if (!res.ok) return { id, url };
    const contentType = res.isBase64 ? "image/png" : undefined;
    const ext = extFromContentType(contentType);
    const path = await writeBinary(`images/${id}.${ext}`, res.body);
    if (path) return { id, path, url };
    return { id, url };
  } catch {
    return { id, url };
  }
}

/** 本地文件 → base64（用于图生图复用历史结果、上传参考图） */
export async function localFileToBase64(path: string): Promise<string | null> {
  return readBinary(path);
}

export async function removeLocalImage(path?: string): Promise<void> {
  if (path) await deleteFile(path);
}

/** 读取图片真实像素尺寸 */
export function probeImageSize(src: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/* ------------------------------------------------------------ 缩略图 */

/** Rust 侧返回的缩略图描述 */
interface ThumbnailResult {
  path: string;
  width: number;
  height: number;
  cached: boolean;
}
/**
 * 缩略图 URL 缓存：`原图路径|长边` → webview URL。
 *
 * 同一张图常在多处同时出现（历史卡片 + 详情 + 首页 gallery + 工作台缩略图条），
 * 不缓存就是重复 invoke + 重复解码。**缓存不设上限是刻意的**：
 * 键是「本机存在的图片文件 × 固定几个尺寸」，数量有天然上界
 * （受历史记录条数与尺寸枚举约束），而缩略图本身就在磁盘上常驻。
 */
const thumbUrlCache = new Map<string, string | null>();

/** 列表类场景的默认长边：覆盖 224px 卡片 / 168px gallery，2x 屏仍清晰 */
export const THUMB_EDGE = 512;

/**
 * 取缩略图的 webview URL。
 *
 * 拿不到（浏览器预览、文件已删、解码失败）时返回 `null`，
 * **由调用方回退到原图**——缩略图是优化，不是功能依赖。
 */
export async function thumbnailUrl(path: string, maxEdge: number = THUMB_EDGE): Promise<string | null> {
  if (!isTauri() || !path) return null;
  // **0 表示「不要缩略图，要原图」**，必须在这里就返回 null。
  // 否则会把 0 原样发给 Rust，而那边 `clamp(64, 2048)` 会把 0 抬成 64——
  // 于是「1:1 原始尺寸」拿到的是一张 64px 的缩略图，功能静默失效。
  if (maxEdge <= 0) return null;
  const key = `${path}|${maxEdge}`;
  if (thumbUrlCache.has(key)) return thumbUrlCache.get(key) ?? null;

  let url: string | null = null;
  try {
    // 返回 null = Rust 判定这张图不值得走缩略图管线（小图直接加载更快）
    const thumb = await invoke<ThumbnailResult | null>("image_thumbnail", {
      source: path,
      maxEdge,
    });
    url = thumb?.path ? await fileUrl(thumb.path) : null;
  } catch {
    // 缩略图失败不该影响功能：静默回退原图
    url = null;
  }
  thumbUrlCache.set(key, url);
  return url;
}

/**
 * 后台预热某个尺寸的缩略图（**不阻塞、不返回结果**）。
 *
 * # 用来消除「查看大图」的首次等待
 *
 * 灯箱要 1024 缩略图，但列表只生成 512——点开一张没预热过的大图时，
 * 那 1024 要**现场解码整张原图**（本机实测 126MB 的 8192² PNG 要 8.3 秒）。
 * 在用户可能点开之前先把 1024 生成好，点开就是毫秒级。
 *
 * fire-and-forget：失败无所谓（灯箱会回退到 512 垫底图），
 * **绝不能把失败抛给调用方**——预热是纯优化，失败不该打扰界面。
 */
export function warmThumbnail(path: string, maxEdge: number): void {
  if (!isTauri() || !path) return;
  void thumbnailUrl(path, maxEdge).catch(() => {
    /* 预热失败无需处理：灯箱有垫底图兜底 */
  });
}

/**
 * 列表场景的展示地址：优先缩略图，失败回退原图。
 *
 * 与 [`imageCandidates`] 的区别：这里只返回**一个**能显示的地址，
 * 不做多候选重试——列表里的图要么能缩要么不能，重试链没有意义。
 */
export async function displayUrl(image: GeneratedImage, maxEdge?: number): Promise<string | null> {
  if (!image) return null;
  if (image.path) {
    const thumb = await thumbnailUrl(image.path, maxEdge);
    if (thumb) return thumb;
    // 缩略图拿不到就回退**原图**。
    //
    // 这一环不能少：`thumbnailUrl` 在两种情况下会返回 null——
    //   1. Rust 判定「小图不值得缩」（≤8MB，占本机 94%）
    //   2. `maxEdge <= 0`（调用方明确要原图，如灯箱 1:1）
    // 漏了它就会一路空到 `return null`，界面报「图片无法加载」——
    // 那是把「没有缩略图」误报成「文件丢了」，小图会**全部**显示不出来。
    const original = await fileUrl(image.path);
    if (original) return original;
  }
  if (image.url) return image.url;
  if (image.dataUrl) return image.dataUrl;
  return null;
}

/** 按优先级返回可尝试的展示地址：本地文件 → 远端链接 → 内联数据 */
export async function imageCandidates(image: GeneratedImage): Promise<string[]> {
  const list: string[] = [];
  if (image.path) {
    const url = await fileUrl(image.path);
    if (url) list.push(url);
  }
  if (image.url) list.push(image.url);
  if (image.dataUrl) list.push(image.dataUrl);
  return list.filter(Boolean);
}

/** 供「另存为」或「发送到图生图」使用的原始 base64 */
export async function imageToBase64(image: GeneratedImage): Promise<string | null> {
  if (image.dataUrl) return dataUrlToBase64(image.dataUrl);
  if (image.path) {
    const local = await readBinary(image.path);
    if (local) return local;
  }
  if (image.url) {
    try {
      const res = await requestRaw({ method: "GET", url: image.url, timeoutMs: 120_000 });
      if (res.ok) return res.isBase64 ? res.body : bytesToBase64(new TextEncoder().encode(res.body));
    } catch {
      return null;
    }
  }
  return null;
}

/* ------------------------------------------------------------ 视觉输入 */

/** 单张参考图发给 LLM 前的体积上限（base64 字符数按 3/4 折算字节） */
const VISION_MAX_BYTES = 4 * 1024 * 1024;
/** 超过这个体积就先缩到 1024px 再转 JPEG */
const VISION_SOFT_BYTES = 1.5 * 1024 * 1024;
const VISION_MAX_EDGE = 1024;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片解码失败"));
    img.src = src;
  });
}

/** 等比缩放到 1024px 以内并转 JPEG，避免把几 MB 的图塞进 chat 请求 */
async function downscaleForVision(dataUrl: string): Promise<string | null> {
  try {
    const img = await loadImage(dataUrl);
    const maxEdge = Math.max(img.naturalWidth, img.naturalHeight);
    const scale = maxEdge > VISION_MAX_EDGE ? VISION_MAX_EDGE / maxEdge : 1;
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // JPEG 不带透明通道，先铺白底，否则透明区域会变成黑色
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.86);
  } catch {
    return null;
  }
}

/**
 * 参考图 → 可直接放进 messages 的 data URL（多模态增强用）。
 * 只支持位图：SVG 会被跳过，过大且压缩失败时返回 null，由调用方按「少送一张图」处理。
 */
export async function toVisionDataUrl(image: GeneratedImage): Promise<string | null> {
  const base64 = await imageToBase64(image);
  if (!base64) return null;

  const raw = dataUrlToBase64(base64).replace(/\s/g, "");
  if (!raw) return null;

  const ext = extFromBase64(raw);
  // 视觉模型不认矢量图，直接跳过
  if (ext === "svg") return null;

  const mime = mimeFromExt(ext);
  const bytes = Math.round((raw.length * 3) / 4);
  const original = `data:${mime};base64,${raw}`;
  if (bytes <= VISION_SOFT_BYTES) return original;

  const shrunk = await downscaleForVision(original);
  const candidate = shrunk ?? original;
  const size = Math.round((dataUrlToBase64(candidate).length * 3) / 4);
  return size <= VISION_MAX_BYTES ? candidate : null;
}

/** 本地图片文件 → GeneratedImage（用于导入外部图片） */
export async function importLocalFiles(files: File[]): Promise<GeneratedImage[]> {
  const out: GeneratedImage[] = [];
  for (const file of files) {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const base64 = bytesToBase64(buffer);
    const ext = (file.name.split(".").pop() ?? "png").toLowerCase();
    const saved = await persistBase64(base64, ext);
    out.push({ ...saved, width: undefined, height: undefined });
  }
  return out;
}

/**
 * 下载/另存图片。
 * 桌面端会复制到系统图片目录下的 Mashiro Studio 文件夹；
 * 浏览器预览则走 <a download>。
 */
export async function downloadImage(image: GeneratedImage, fileName: string): Promise<string | null> {
  if (image.path) {
    const saved = await exportCopy(image.path, fileName);
    if (saved) return saved;
  }
  const candidates = await imageCandidates(image);
  const src = candidates[0];
  if (!src) return null;
  const anchor = document.createElement("a");
  anchor.href = src;
  anchor.download = fileName;
  anchor.target = "_blank";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return fileName;
}

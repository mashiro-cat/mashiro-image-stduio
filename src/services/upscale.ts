/* ==========================================================================
   本地超分（AI Upscale）
   推理在 Rust 侧完成（ONNX Runtime，CPU），本文件是前端唯一入口。
   视图里不要直接 invoke upscale_* 命令——统一从这里过，浏览器预览的降级
   与错误文案都收在这里。
   ========================================================================== */

import type { GeneratedImage } from "../types";
import { isTauri, invoke, uid } from "../platform/env";
import { toAbsolutePath } from "../platform/storage";

/** 单个超分模型的描述 */
export interface UpscaleModelInfo {
  id: string;
  label: string;
  note: string;
  scale: number;
  /** 预计下载体积；已下载为 0 */
  sizeBytes: number;
  installed: boolean;
}

/** 本机超分能力概览 */
export interface UpscaleStatus {
  available: boolean;
  installed: string[];
  defaultModel: string;
}

/** 单张超分结果 */
export interface UpscaleResult {
  path: string;
  relativePath: string;
  width: number;
  height: number;
  scale: number;
  /**
   * 实际使用的推理后端（`"CPU"` / `"GPU（DirectML）"`）。
   * 用户开了 GPU 但注册失败时会回退 CPU —— 界面要如实显示，
   * 不能在悄悄回退时还宣称「GPU 加速」。
   */
  backend: string;
}

/** GPU 可用性探测结果 */
export interface GpuProbe {
  supported: boolean;
  /** 不支持时的原因，面向用户可直接展示 */
  reason: string;
}

const NOT_DESKTOP = "本地超分仅在桌面端可用，浏览器预览下无法运行 ONNX 推理";

/** 能力概览；浏览器预览返回「不可用」而不是抛错 */
export async function getUpscaleStatus(): Promise<UpscaleStatus> {
  if (!isTauri()) {
    return { available: false, installed: [], defaultModel: "" };
  }
  return invoke<UpscaleStatus>("upscale_status");
}

/** 模型列表 */
export async function listModels(): Promise<UpscaleModelInfo[]> {
  if (!isTauri()) return [];
  return invoke<UpscaleModelInfo[]>("upscale_list_models");
}

/** 下载模型（十几 MB 起，别在用户没点之前调） */
export async function downloadModel(modelId: string): Promise<string> {
  if (!isTauri()) throw new Error(NOT_DESKTOP);
  return invoke<string>("upscale_download_model", { modelId });
}

/** 删除已下载的模型 */
export async function removeModel(modelId: string): Promise<void> {
  if (!isTauri()) throw new Error(NOT_DESKTOP);
  await invoke("upscale_remove_model", { modelId });
}

/**
 * 超分产物的相对路径（数据目录内）。
 *
 * 注意这里返回的是**相对路径**，调用方必须先经 `toAbsolutePath()` 转换——
 * Rust 的 `guard_path` 只认绝对路径，直接传相对路径会被白名单拒绝
 * （`upscale_image` 报「拒绝访问应用数据目录之外的文件」）。
 * 这与 `storage.ts` 的 `writeBinary()` 是同一条规矩。
 */
function outputName(modelId: string): string {
  return `images/${uid("up")}-${modelId}.png`;
}

/** 相对路径 → 绝对路径（数据目录内）。失败说明数据目录定位不了，抛给上层处理。 */
async function absoluteOut(modelId: string): Promise<string> {
  const path = await toAbsolutePath(outputName(modelId));
  if (!path) throw new Error("无法定位应用数据目录");
  return path;
}

/**
 * 对一张已落盘的图做超分，返回新的 `GeneratedImage`。
 *
 * **产物是独立的新图，不覆盖原图**——用户要的是「对比着看」，
 * 原地覆盖会让他连原图都找不回来。
 * 原图仍然挂在历史记录上，所以两张图都不会变成孤儿文件。
 *
 * 传 `image` 里没有 `path` 的（远端链接或内联 data URL）会直接失败：
 * 推理要读本地文件，让用户先「另存」或等下载完更符合直觉。
 */
/**
 * 探测本机是否支持 GPU 加速。
 *
 * **代价约 1~2 秒**（要真的建一次 ONNX 会话），所以不要在打开页面时自动调——
 * 只在用户点了「检测」时调。界面用 `gpuState` 三态表示未检测/检测中/已检测。
 */
export async function probeGpu(modelId?: string): Promise<GpuProbe> {
  if (!isTauri()) throw new Error(NOT_DESKTOP);
  return invoke<GpuProbe>("upscale_probe_gpu", { modelId: modelId ?? null });
}

export async function upscaleImage(
  image: GeneratedImage,
  modelId?: string,
  scale?: number,
  useGpu?: boolean,
  maxEdge?: number,
): Promise<UpscaleResult> {
  if (!isTauri()) throw new Error(NOT_DESKTOP);
  if (!image.path) {
    throw new Error("该图片没有本地文件，无法超分");
  }
  return invoke<UpscaleResult>("upscale_image", {
    source: image.path,
    outPath: await absoluteOut(modelId ?? "x4"),
    modelId: modelId ?? null,
    scale: scale ?? null,
    useGpu: useGpu ?? false,
    maxEdge: maxEdge ?? null,
  });
}

/** 批量超分：串行执行，失败不中断整批 */
export async function upscaleBatch(
  images: GeneratedImage[],
  modelId?: string,
  scale?: number,
  useGpu?: boolean,
  maxEdge?: number,
): Promise<UpscaleResult[]> {
  if (!isTauri()) throw new Error(NOT_DESKTOP);
  const sources = images.map((image) => image.path).filter((p): p is string => Boolean(p));
  if (!sources.length) {
    throw new Error("所选图片都没有本地文件，无法超分");
  }
  const tag = modelId ?? "x4";
  return invoke<UpscaleResult[]>("upscale_batch", {
    sources,
    // 每张都要独立的文件名：共用一个路径会让后一张覆盖前一张
    outPaths: await Promise.all(sources.map(() => absoluteOut(tag))),
    modelId: modelId ?? null,
    scale: scale ?? null,
    useGpu: useGpu ?? false,
    maxEdge: maxEdge ?? null,
  });
}

/** 结果 → 可直接塞进 images 数组的形状 */
export function toGeneratedImage(result: UpscaleResult): GeneratedImage {
  return { id: uid("img"), path: result.path };
}

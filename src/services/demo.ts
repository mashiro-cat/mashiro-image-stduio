/* ==========================================================================
   演示数据：未配置任何密钥时，仍然可以完整体验「编辑提示词 → 生成 → 入库」流程
   ========================================================================== */

import type { EnhanceResult, StructuredPrompt } from "../types";
import { uid, sizeLabel } from "../platform/env";
import { persistBase64 } from "../platform/media";
import { bytesToBase64 } from "../platform/http";
import type { GeneratedImage } from "../types";

const PALETTES = [
  ["#6366f1", "#a855f7", "#ec4899"],
  ["#0ea5e9", "#22d3ee", "#14b8a6"],
  ["#f59e0b", "#ef4444", "#ec4899"],
  ["#10b981", "#84cc16", "#eab308"],
  ["#8b5cf6", "#6366f1", "#0ea5e9"],
  ["#f43f5e", "#fb923c", "#facc15"],
  ["#14b8a6", "#3b82f6", "#6366f1"],
  ["#a855f7", "#d946ef", "#f472b6"],
];

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** 按尺寸解析宽高比 */
export function ratioOf(size: string): number {
  const match = size.match(/^(\d+)\s*[x×*]\s*(\d+)$/i);
  if (!match) return 1;
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!w || !h) return 1;
  return w / h;
}

/** 生成一张渐变风格占位图（SVG → data URL） */
export function mockImageDataUrl(prompt: string, size: string, index = 0, watermark = true): string {
  const seed = hash(`${prompt}#${index}`);
  const palette = PALETTES[seed % PALETTES.length];
  const ratio = ratioOf(size);
  const width = ratio >= 1 ? 1280 : Math.round(1280 * ratio);
  const height = ratio >= 1 ? Math.round(1280 / ratio) : 1280;
  const label = prompt.trim().slice(0, 60) || "未填写提示词";

  const blobs = Array.from({ length: 5 }, (_, i) => {
    const r = 160 + ((seed >> (i * 3)) % 220);
    const cx = ((seed >> (i * 5)) % width) + 60;
    const cy = ((seed >> (i * 7)) % height) + 60;
    const fill = palette[(seed + i) % palette.length];
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" opacity="0.45" filter="url(#blur)"/>`;
  }).join("");

  const lines = label.match(/.{1,26}/g) ?? [label];
  const text = lines
    .slice(0, 3)
    .map(
      (line, i) =>
        `<text x="50%" y="${height / 2 + (i - (Math.min(lines.length, 3) - 1) / 2) * 46}" text-anchor="middle" font-family="Inter, 'PingFang SC', 'Microsoft YaHei', sans-serif" font-size="34" font-weight="600" fill="#ffffff" opacity="0.94">${escapeXml(line)}</text>`,
    )
    .join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="${palette[0]}"/><stop offset="100%" stop-color="${palette[1]}"/>
  </linearGradient>
  <filter id="blur"><feGaussianBlur stdDeviation="90"/></filter>
</defs>
<rect width="${width}" height="${height}" fill="url(#bg)"/>
${blobs}
<rect width="${width}" height="${height}" fill="rgba(8,10,18,0.34)"/>
${watermark ? `<text x="36" y="56" font-family="Inter, sans-serif" font-size="22" font-weight="700" fill="#ffffff" opacity="0.7">DEMO</text>` : ""}
<text x="${width - 36}" y="56" text-anchor="end" font-family="Inter, sans-serif" font-size="20" fill="#ffffff" opacity="0.6">${escapeXml(sizeLabel(size))}</text>
${text}
${watermark ? `<text x="50%" y="${height - 40}" text-anchor="middle" font-family="Inter, sans-serif" font-size="17" fill="#ffffff" opacity="0.55">Mashiro Studio · 演示模式占位图</text>` : ""}
</svg>`;

  return `data:image/svg+xml;base64,${bytesToBase64(new TextEncoder().encode(svg))}`;
}

/** 演示模式下的文生图结果 */
export async function mockGenerate(
  prompt: string,
  size: string,
  count: number,
  startIndex = 0,
): Promise<{ images: GeneratedImage[]; revisedPrompts: string[] }> {
  const images: GeneratedImage[] = [];
  for (let i = 0; i < count; i += 1) {
    const dataUrl = mockImageDataUrl(prompt, size, startIndex + i);
    const image = await persistBase64(dataUrl.split(",")[1], "svg");
    images.push({ ...image, dataUrl: image.dataUrl ?? dataUrl });
  }
  return { images, revisedPrompts: [] };
}

/** 演示模式下的图生图结果（保留输入图作为底图观感） */
export async function mockEdit(
  prompt: string,
  size: string,
  count: number,
): Promise<{ images: GeneratedImage[]; revisedPrompts: string[] }> {
  return mockGenerate(`${prompt} · edited`, size, count, 7);
}

/** 演示模式下的提示词增强结果 */
export function mockEnhance(prompt: string, negative: string, style: string): EnhanceResult {
  const base = prompt.trim() || "一个安静的场景";
  const structured: StructuredPrompt = {
    subject: `${base} 的主体，细节清晰可辨`,
    scene: "延续原始意图的环境氛围，加入可辨识的环境元素",
    style: style || "电影感写实摄影",
    lens: "35mm 焦段，浅景深，主体居中偏三分构图",
    lighting: "柔和侧逆光，边缘光勾勒轮廓",
    color: "低饱和青橙对比，保留皮肤与环境层次",
    negative: "低分辨率、模糊、多手指、水印、文字、过曝",
  };
  const enhanced = [
    base,
    "highly detailed",
    "cinematic composition",
    "natural skin texture",
    "volumetric light",
    "35mm lens, shallow depth of field",
    "teal and orange color grading",
    "professional photography",
    "8k, sharp focus",
  ].join(", ");

  return {
    prompt: enhanced,
    negative: negative || "lowres, blurry, extra fingers, watermark, text, jpeg artifacts, oversaturated",
    structured,
    notes: [
      "补充了镜头与景深信息",
      "明确了光线方向与色彩倾向",
      "按「主体→场景→镜头→光线→风格」重排",
      "追加通用负向提示词",
      "演示模式：未调用真实模型",
    ],
  };
}

export const DEMO_TAG = uid("demo");

/**
 * 演示模式下的「提示词反推」结果。
 * 反推与增强方向相反，所以这里给的是「观察所得」，不要复用 mockEnhance 的文案。
 */
export function mockReverse(hint: string, style: string, imageCount: number): EnhanceResult {
  const subject = hint.trim() || "画面中识别到的主体";
  const structured: StructuredPrompt = {
    subject: `${subject}（观察自${imageCount ? "图片" : "生成参数"}）`,
    scene: "环境元素完整，前后景层次清晰可辨",
    style: style || "写实摄影风格",
    lens: "中焦段平视视角，主体占据画面中心区域",
    lighting: "自然光为主，光源偏侧上方",
    color: "整体偏暖，暗部保留一定冷色对比",
    negative: "低分辨率、模糊、结构错误、水印、文字",
  };
  return {
    prompt: [
      subject,
      "clearly defined subject with accurate proportions",
      "detailed textures and materials",
      "balanced composition",
      "natural lighting from upper side",
      "warm tone with cool shadow contrast",
      "photorealistic rendering",
      "sharp focus, high detail",
    ].join(", "),
    negative: "lowres, blurry, malformed structure, watermark, text, oversaturated",
    structured,
    notes: [
      imageCount ? `依据 ${Math.min(imageCount, 4)} 张图片反推` : "依据历史参数反推",
      "按「主体→场景→镜头→光线→色彩」重排",
      "补齐了镜头与光线描述",
      "演示模式：未调用真实模型",
    ],
  };
}

/* ==========================================================================
   MCP 工具执行桥
   外部 Agent 客户端通过 MCP 调用的工具，最终都由这里落地执行。

   为什么放在前端而不是 Rust：生图链路（渠道配置、上游协议、结果落盘、
   历史记录、演示模式）已经完整地在这里了。Rust 侧只做协议与传输，
   能力复用这一侧，才不会出现两套会各自漂移的实现。

   工具名与参数名和 `src-tauri/src/mcp/tools.rs` 的 schema 一一对应。
   ========================================================================== */

import type {
  GeneratedImage,
  ImageQuality,
  McpCallRecord,
  ModelApiConfig,
  WorkflowInput,
  WorkflowPreset,
} from "../types";
import { AUTO_SIZE } from "../types";
import { ASPECT_OPTIONS, QUALITY_OPTIONS, useSettingsStore } from "../stores/settings";
import { createRecord, useHistoryStore } from "../stores/history";
import { usePromptStore } from "../stores/prompts";
import { usePresetsStore } from "../stores/presets";
import { ApiError } from "../platform/http";
import {
  imageToBase64,
  localFileToBase64,
  mimeFromPath,
  persistRemote,
} from "../platform/media";
import { lastStorageError } from "../platform/storage";
import { formatDuration, sizeLabelZh, uid } from "../platform/env";
import { editImages, generateImages } from "./modelApi";
import { collectResults, createTask, pollTask, uploadAsset } from "./workflowApi";
import { mockEdit, mockGenerate, mockEnhance } from "./demo";
import { enhancePrompt } from "./promptEnhance";
import { listenMcpRequests, mcpReportBridge, mcpRespond, type McpRequest } from "../platform/mcp";

type ToolArgs = Record<string, unknown>;

interface ToolOutcome {
  text: string;
  data?: unknown;
}

/* ------------------------------------------------------------ 参数读取 */

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function asPathList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => asText(item)).filter(Boolean);
  }
  const single = asText(value);
  return single ? [single] : [];
}

function required(args: ToolArgs, key: string, label: string): string {
  const value = asText(args[key]);
  if (!value) throw new Error(`缺少 ${key}（${label}）`);
  return value;
}

/** 摘要一行，写进调用记录里给设置页展示 */
function summarizeArgs(args: ToolArgs): string {
  const parts: string[] = [];
  if (typeof args.prompt === "string" && args.prompt.trim()) {
    parts.push(`prompt=${args.prompt.trim().slice(0, 60)}`);
  }
  if (typeof args.keyword === "string" && args.keyword.trim()) {
    parts.push(`keyword=${args.keyword.trim().slice(0, 40)}`);
  }
  if (args.size) parts.push(`size=${String(args.size)}`);
  if (args.count) parts.push(`count=${String(args.count)}`);
  if (args.workflow) parts.push(`workflow=${String(args.workflow)}`);
  const images = asPathList(args.images);
  if (images.length) parts.push(`images=${images.length} 张`);
  return parts.join(" · ") || "无参数";
}

/* ------------------------------------------------------------ 通用工具 */

const QUALITY_VALUES: ImageQuality[] = ["auto", "high", "medium", "low"];
const SIZE_VALUES = ASPECT_OPTIONS.map((option) => option.size);

function resolveSize(value: unknown, fallback: string): string {
  const size = asText(value) || fallback || AUTO_SIZE;
  if (size === AUTO_SIZE) return size;
  if (!SIZE_VALUES.includes(size)) {
    throw new Error(
      `不支持的尺寸「${size}」。可用取值：${SIZE_VALUES.join("、")}（auto 表示由模型自行决定画幅）`,
    );
  }
  return size;
}

function resolveQuality(value: unknown, fallback: ImageQuality): ImageQuality {
  const quality = asText(value);
  if (!quality) return fallback;
  if (!QUALITY_VALUES.includes(quality as ImageQuality)) {
    throw new Error(`不支持的画质「${quality}」。可用取值：${QUALITY_VALUES.join("、")}`);
  }
  return quality as ImageQuality;
}

/** 模型名必须落在渠道的模型列表里，否则上游多半直接报错，不如在这里说清楚可选项 */
function resolveModel(channel: ModelApiConfig, value: unknown): string {
  const model = asText(value);
  if (!model) return channel.model;
  const options = channel.modelOptions.filter(Boolean);
  if (options.length && !options.includes(model)) {
    throw new Error(
      `渠道「${channel.name}」没有模型「${model}」。该渠道可用模型：${options.join("、")}`,
    );
  }
  return model;
}

/**
 * 风格：先按预设名匹配（走「预设中心」的当前配置），匹配不到就当成一段风格描述直接追加。
 * 风格表已经是可编辑数据，这里不再引用硬编码常量。
 */
function applyStyle(prompt: string, value: unknown): string {
  const style = asText(value);
  if (!style) return prompt;
  const preset = usePresetsStore().findStyle(style);
  return `${prompt}\n\nStyle: ${preset ? preset.value : style}`;
}

/**
 * 把工具传来的图片位置变成可用的图片对象。
 * 既接受本地路径也接受 http(s) 链接——Agent 手里常常是链接，
 * 让它在外面先下载再传路径既绕又容易出错。
 */
async function resolveImages(paths: string[], limit = 4): Promise<GeneratedImage[]> {
  const out: GeneratedImage[] = [];
  for (const raw of paths.slice(0, limit)) {
    if (/^https?:\/\//i.test(raw)) {
      const image = await persistRemote(raw);
      if (!image.path && !image.dataUrl && !image.url) {
        throw new Error(`下载图片失败：${raw}`);
      }
      out.push({ ...image, url: image.url ?? raw });
      continue;
    }
    const base64 = await localFileToBase64(raw);
    if (!base64) {
      const detail = lastStorageError();
      throw new Error(
        `读不到图片「${raw}」${detail ? `：${detail}` : ""}。只能读取应用数据目录、图片 / 下载 / 桌面目录下的文件，也可以直接传 http(s) 图片链接。`,
      );
    }
    out.push({ id: uid("img"), path: raw });
  }
  return out;
}

function describeImages(images: GeneratedImage[]): string {
  return images
    .map((image, index) => {
      const where = image.path ?? image.url ?? "（未落盘）";
      const size = image.width && image.height ? ` · ${image.width}×${image.height}` : "";
      return `${index + 1}. ${where}${size}`;
    })
    .join("\n");
}

/** 统一的成功文案：把「在哪儿能找到结果」说清楚，Agent 才能接着用 */
function buildResultText(options: {
  title: string;
  images: GeneratedImage[];
  durationMs: number;
  channel: string;
  model: string;
  size: string;
  note?: string;
}): string {
  const lines = [
    `${options.title}（用时 ${formatDuration(options.durationMs)}）`,
    `渠道：${options.channel} · 模型：${options.model} · 尺寸：${sizeLabelZh(options.size)}`,
    `图片已保存到本机，文件路径：`,
    describeImages(options.images),
  ];
  if (options.note) lines.push(options.note);
  lines.push("图片同时已写入 Mashiro Studio 的历史记录，可在应用内查看。");
  return lines.join("\n");
}

function describeUnknown(err: unknown): string {
  if (err instanceof ApiError) {
    return [err.message, err.hint].filter(Boolean).join(" · ");
  }
  return err instanceof Error ? err.message : String(err);
}

/* ------------------------------------------------------------ 文生图 / 图生图 */

async function runModelTool(args: ToolArgs, mode: "text2img" | "img2img"): Promise<ToolOutcome> {
  const settings = useSettingsStore();
  const history = useHistoryStore();

  const prompt = required(args, "prompt", mode === "text2img" ? "画面描述" : "改写要求");
  const negative = asText(args.negative);
  const count = asInt(args.count, settings.state.app.defaultCount, 1, 4);
  const size = resolveSize(args.size, settings.state.app.defaultSize);
  const host = settings.activeModelChannel;
  const demo = settings.useDemo;

  if (!demo && !host) {
    throw new Error(
      "没有可用的生图渠道：请在 Mashiro Studio 的「设置 → 生图渠道」里启用一个渠道并填写 API Key，或在「设置 → 外观与默认值」里开启演示模式。",
    );
  }

  const quality = resolveQuality(args.quality, host?.quality ?? "high");
  const model = host ? resolveModel(host, args.model) : "演示模式（占位图）";
  const styled = applyStyle(prompt, args.style);

  let references: GeneratedImage[] = [];
  if (mode === "img2img") {
    const paths = asPathList(args.images);
    if (!paths.length) throw new Error("图生图需要至少一张参考图（images）");
    references = await resolveImages(paths, 4);
    if (!references.length) throw new Error("参考图读取失败，请重新指定图片路径");
  }

  const channelName = demo ? "演示模式" : (host?.name ?? "未配置渠道");
  const record = createRecord({
    mode,
    provider: "model",
    status: "running",
    prompt,
    negative,
    params: {
      model,
      // 标上 MCP，历史记录里一眼能看出这条不是在工作台点的
      channel: `${channelName} · MCP`,
      size,
      count,
      quality,
    },
    inputImages:
      mode === "img2img" ? references.map((image) => image.path ?? image.url ?? "") : [],
    workflowName: "",
  });
  if (settings.state.app.autoSaveHistory) history.add(record);

  const startedAt = Date.now();
  try {
    let images: GeneratedImage[] = [];

    if (demo) {
      await new Promise((resolve) => setTimeout(resolve, 900 + count * 320));
      const result =
        mode === "img2img"
          ? await mockEdit(styled, size, count)
          : await mockGenerate(styled, size, count);
      images = result.images;
    } else if (mode === "img2img") {
      const payload = [];
      for (const reference of references) {
        const base64 = await imageToBase64(reference);
        if (!base64) continue;
        payload.push({
          fileName: `reference_${reference.id}.png`,
          mime: mimeFromPath(reference.path),
          dataBase64: base64,
        });
      }
      if (!payload.length) throw new ApiError("参考图读取失败，请重新指定图片路径");
      if (!host) throw new ApiError("没有可用的生图渠道");
      const result = await editImages(host, {
        prompt: styled,
        negative,
        model,
        n: count,
        size,
        quality,
        images: payload,
      });
      images = result.images;
    } else {
      if (!host) throw new ApiError("没有可用的生图渠道");
      const result = await generateImages(host, {
        prompt: styled,
        negative,
        model,
        n: count,
        size,
        quality,
      });
      images = result.images;
    }

    const durationMs = Date.now() - startedAt;
    if (settings.state.app.autoSaveHistory) {
      history.update(record.id, { status: "success", images, durationMs });
    }

    return {
      text: buildResultText({
        title: mode === "img2img" ? `已基于 ${references.length} 张参考图生成 ${images.length} 张图片` : `已生成 ${images.length} 张图片`,
        images,
        durationMs,
        channel: channelName,
        model,
        size,
        note: demo ? "注意：当前处于演示模式（未配置生图渠道），返回的是占位图。" : undefined,
      }),
      data: {
        mode,
        channel: channelName,
        model,
        size,
        count,
        durationMs,
        recordId: record.id,
        images: images.map((image) => ({
          path: image.path ?? null,
          url: image.url ?? null,
          width: image.width ?? null,
          height: image.height ?? null,
        })),
      },
    };
  } catch (err) {
    if (settings.state.app.autoSaveHistory) {
      history.update(record.id, {
        status: "failed",
        error: describeUnknown(err),
        durationMs: Date.now() - startedAt,
      });
    }
    throw err;
  }
}

/* ------------------------------------------------------------ 工作流生图 */

/** 找到要跑的工作流：按名称 / id 匹配，留空用当前激活的那个 */
function resolvePreset(nameOrId: string): WorkflowPreset {
  const settings = useSettingsStore();
  const list = settings.workflowPresets;
  if (!list.length) {
    throw new Error(
      "当前工作流渠道下没有工作流预设。请先在 Mashiro Studio 的「设置 → 工作流渠道」里添加工作流并识别节点。",
    );
  }
  if (!nameOrId) {
    const active = settings.activePreset ?? list[0];
    if (!active) throw new Error("没有可用的工作流预设");
    return active;
  }
  const hit = list.find(
    (preset) => preset.id === nameOrId || preset.name === nameOrId || preset.workflowId === nameOrId,
  );
  if (!hit) {
    throw new Error(
      `没有找到工作流「${nameOrId}」。当前可用的工作流：${list.map((preset) => preset.name).join("、")}`,
    );
  }
  return hit;
}

async function runWorkflowTool(args: ToolArgs): Promise<ToolOutcome> {
  const settings = useSettingsStore();
  const history = useHistoryStore();

  const channel = settings.activeWorkflowChannel;
  if (!channel || !settings.hasWorkflowApi) {
    throw new Error(
      "没有可用的工作流渠道：请在 Mashiro Studio 的「设置 → 工作流渠道」里启用渠道并填写工作流 API Key。",
    );
  }

  const preset = resolvePreset(asText(args.workflow));
  if (!preset.workflowId) {
    throw new Error(`工作流「${preset.name}」还没有配置 workflowId，请先到设置页补全。`);
  }

  const prompt = asText(args.prompt);
  const negative = asText(args.negative);
  const inputs = preset.nodes.inputs.filter((input) => input.nodeId.trim());
  if (!inputs.length) {
    throw new Error(
      `工作流「${preset.name}」还没有输入槽位。请到「设置 → 工作流渠道」点一次「识别节点」或手动添加输入。`,
    );
  }

  // 图片槽位：按顺序把传入的路径分给各图片节点，数量不匹配就直接说清楚，
  // 而不是提交一个注定失败的任务
  const imageInputs = inputs.filter((input) => input.role === "image");
  const paths = asPathList(args.images);
  if (imageInputs.length && paths.length !== imageInputs.length) {
    throw new Error(
      `工作流「${preset.name}」需要 ${imageInputs.length} 张图片（${imageInputs
        .map((input) => input.label)
        .join("、")}），实际收到 ${paths.length} 张。`,
    );
  }
  const images = await resolveImages(paths, imageInputs.length || 4);

  const texts: Record<string, string> = {};
  const numbers: Record<string, number> = {};
  for (const input of inputs) {
    if (input.role === "positive" && prompt) texts[input.id] = prompt;
    else if (input.role === "negative" && negative) texts[input.id] = negative;
  }
  const seed = args.seed === undefined || args.seed === null ? undefined : asInt(args.seed, 0, 0, 2 ** 31 - 1);
  const steps = args.steps === undefined || args.steps === null ? undefined : asInt(args.steps, 0, 1, 200);
  const fillNumbers = (role: WorkflowInput["role"], value?: number) => {
    if (value === undefined) return;
    for (const input of inputs.filter((item) => item.role === role)) numbers[input.id] = value;
  };
  fillNumbers("seed", seed);
  fillNumbers("steps", steps);

  const record = createRecord({
    mode: "workflow",
    provider: "workflow",
    status: "running",
    prompt,
    negative,
    params: {
      model: preset.name,
      channel: `${channel.name} · MCP`,
      seed,
      steps,
    },
    inputImages: images.map((image) => image.path ?? image.url ?? ""),
    workflowName: preset.name,
  });
  if (settings.state.app.autoSaveHistory) history.add(record);

  const startedAt = Date.now();
  try {
    const files: Record<string, string> = {};
    for (let index = 0; index < imageInputs.length; index += 1) {
      const input = imageInputs[index];
      const image = images[index];
      if (!image) continue;
      const base64 = await imageToBase64(image);
      if (!base64) throw new ApiError(`「${input.label}」读取失败，请重新指定图片`);
      const uploaded = await uploadAsset(channel, {
        fileName: `input_${image.id}.png`,
        mime: mimeFromPath(image.path),
        dataBase64: base64,
      });
      files[input.id] = uploaded.fileName;
    }

    const created = await createTask(channel, { preset, values: { texts, numbers, files } });
    history.update(record.id, { taskId: created.taskId });

    const final = await pollTask(channel, created.taskId, {});
    const resultImages = await collectResults(final);
    const durationMs = Date.now() - startedAt;

    if (settings.state.app.autoSaveHistory) {
      history.update(record.id, {
        status: "success",
        images: resultImages,
        durationMs,
        taskId: final.taskId,
      });
    }

    return {
      text: [
        `工作流「${preset.name}」执行完成，产出 ${resultImages.length} 张图片（用时 ${formatDuration(durationMs)}）。`,
        `任务 ID：${final.taskId}`,
        "图片已下载到本机，文件路径：",
        describeImages(resultImages),
      ].join("\n"),
      data: {
        mode: "workflow",
        workflow: preset.name,
        workflowId: preset.workflowId,
        taskId: final.taskId,
        durationMs,
        recordId: record.id,
        images: resultImages.map((image) => ({ path: image.path ?? null, url: image.url ?? null })),
      },
    };
  } catch (err) {
    if (settings.state.app.autoSaveHistory) {
      history.update(record.id, {
        status: "failed",
        error: describeUnknown(err),
        durationMs: Date.now() - startedAt,
      });
    }
    throw err;
  }
}

/* ------------------------------------------------------------ 只读工具 */

function listCapabilities(): ToolOutcome {
  const settings = useSettingsStore();
  const history = useHistoryStore();
  const prompts = usePromptStore();
  const llmReady = settings.hasLlm;

  const channels = settings.state.modelApi.channels.map((channel) => ({
    id: channel.id,
    name: channel.name,
    enabled: channel.enabled,
    usable: Boolean(channel.apiKey) && channel.enabled,
    model: channel.model,
    models: channel.modelOptions.filter(Boolean),
    defaultQuality: channel.quality,
    responseFormat: channel.responseFormat,
  }));

  const workflows = settings.workflowPresets.map((preset) => ({
    id: preset.id,
    name: preset.name,
    workflowId: preset.workflowId,
    active: preset.id === settings.activePreset?.id,
    inputs: preset.nodes.inputs.map((input) => ({
      role: input.role,
      label: input.label,
      nodeId: input.nodeId,
      fieldName: input.fieldName,
    })),
  }));

  const data = {
    demoMode: settings.useDemo,
    modelChannel: settings.activeModelChannel
      ? {
          id: settings.activeModelChannel.id,
          name: settings.activeModelChannel.name,
          model: settings.activeModelChannel.model,
          models: settings.activeModelChannel.modelOptions.filter(Boolean),
        }
      : null,
    modelChannels: channels,
    workflowChannel: settings.activeWorkflowChannel
      ? { id: settings.activeWorkflowChannel.id, name: settings.activeWorkflowChannel.name }
      : null,
    workflows,
    sizes: ASPECT_OPTIONS.map((option) => ({ value: option.size, label: option.label, hint: option.hint })),
    qualities: QUALITY_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
    styles: usePresetsStore().styles.map((preset) => preset.label),
    llmReady,
    promptLibrary: { total: prompts.items.length },
    history: { records: history.records.length },
  };

  const lines: string[] = [];
  if (data.demoMode) {
    lines.push(
      "当前处于演示模式（没有启用任何生图渠道，或手动开启了演示模式）：生成会返回占位图。要出真实结果，请让用户在应用里配置生图渠道。",
    );
  }
  lines.push(
    settings.activeModelChannel
      ? `生图渠道：${settings.activeModelChannel.name} · 默认模型 ${settings.activeModelChannel.model}${
          settings.activeModelChannel.modelOptions.length
            ? ` · 可选模型 ${settings.activeModelChannel.modelOptions.filter(Boolean).join("、")}`
            : ""
        }`
      : "生图渠道：无可用渠道",
  );
  lines.push(
    workflows.length
      ? `工作流（${settings.activeWorkflowChannel?.name ?? "无渠道"}）：${workflows
          .map((preset) => `${preset.name}${preset.active ? "(当前)" : ""}`)
          .join("、")}`
      : "工作流：无可用预设",
  );
  if (workflows.length) {
    for (const preset of workflows) {
      const slots = preset.inputs.map((input) => `${input.role}:${input.label}`).join("、") || "（无输入槽位）";
      lines.push(`  · ${preset.name} 的槽位：${slots}`);
    }
  }
  lines.push(`可选尺寸：${SIZE_VALUES.join("、")}`);
  lines.push(`可选画质：${QUALITY_VALUES.join("、")}`);
  lines.push(`风格预设：${data.styles.join("、")}`);
  lines.push(`提示词增强（LLM）：${llmReady ? "已配置，可用于 mashiro_enhance_prompt" : "未配置，mashiro_enhance_prompt 会失败"}`);

  return { text: lines.join("\n"), data };
}

async function enhance(args: ToolArgs): Promise<ToolOutcome> {
  const settings = useSettingsStore();
  const prompt = required(args, "prompt", "原始想法");
  const negative = asText(args.negative);
  const style = asText(args.style);
  const language = asText(args.language) === "zh" ? "zh" : "en";
  const options = { style, language, structured: true } as const;

  const result = settings.useDemo || !settings.hasLlm
    ? mockEnhance(prompt, negative, style)
    : await enhancePrompt(settings.state.llm, { prompt, negative, options });

  const lines = [
    `【正向提示词】${result.prompt}`,
    `【负向提示词】${result.negative || "（无）"}`,
  ];
  const structured = result.structured;
  if (structured) {
    lines.push(
      `【结构化拆解】主体：${structured.subject || "-"}；场景：${structured.scene || "-"}；风格：${
        structured.style || "-"
      }；镜头：${structured.lens || "-"}；光线：${structured.lighting || "-"}；色彩：${structured.color || "-"}`,
    );
  }
  if (result.notes.length) lines.push(`【改动说明】${result.notes.join("；")}`);
  if (!settings.hasLlm) lines.push("注意：未配置 LLM 模型 API，本次结果是本地演示数据。");

  return {
    text: lines.join("\n"),
    data: {
      prompt: result.prompt,
      negative: result.negative,
      structured: result.structured,
      notes: result.notes,
    },
  };
}

function searchPrompts(args: ToolArgs): ToolOutcome {
  const prompts = usePromptStore();
  const keyword = asText(args.keyword).toLowerCase();
  const limit = asInt(args.limit, 10, 1, 50);
  const favoriteOnly = args.favorite === true;

  const matched = prompts.items
    .filter((item) => {
      if (favoriteOnly && !item.favorite) return false;
      if (!keyword) return true;
      return (
        item.title.toLowerCase().includes(keyword) ||
        item.content.toLowerCase().includes(keyword) ||
        item.negative.toLowerCase().includes(keyword) ||
        item.tags.some((tag) => tag.toLowerCase().includes(keyword))
      );
    })
    .slice(0, limit);

  if (!matched.length) {
    return {
      text: keyword
        ? `提示词库里没有匹配「${keyword}」的条目（共 ${prompts.items.length} 条）。`
        : `提示词库为空（共 ${prompts.items.length} 条）。`,
      data: { total: prompts.items.length, items: [] },
    };
  }

  const lines = matched.map(
    (item, index) =>
      `${index + 1}. ${item.title}［${item.category}${item.tags.length ? ` · ${item.tags.join("/")}` : ""}］\n   正文：${
        item.content
      }${item.negative ? `\n   负向：${item.negative}` : ""}`,
  );

  return {
    text: `在提示词库中匹配到 ${matched.length} 条（库内共 ${prompts.items.length} 条）：\n${lines.join("\n")}`,
    data: {
      total: prompts.items.length,
      items: matched.map((item) => ({
        id: item.id,
        title: item.title,
        content: item.content,
        negative: item.negative,
        category: item.category,
        tags: item.tags,
        favorite: item.favorite,
        usageCount: item.usageCount,
      })),
    },
  };
}

function generationHistory(args: ToolArgs): ToolOutcome {
  const history = useHistoryStore();
  const keyword = asText(args.keyword).toLowerCase();
  const limit = asInt(args.limit, 10, 1, 50);

  const matched = history.records
    .filter((record) => {
      if (!keyword) return true;
      return (
        record.prompt.toLowerCase().includes(keyword) ||
        record.params.model?.toLowerCase().includes(keyword) ||
        record.workflowName?.toLowerCase().includes(keyword)
      );
    })
    .slice(0, limit);

  if (!matched.length) {
    return {
      text: `没有找到生成记录（全部记录 ${history.records.length} 条）。`,
      data: { total: history.records.length, records: [] },
    };
  }

  const lines = matched.map((record, index) => {
    const images = record.images
      .map((image) => image.path ?? image.url ?? "")
      .filter(Boolean)
      .join("，");
    return `${index + 1}. [${record.mode}·${record.status}] ${record.prompt.slice(0, 100)}${
      images ? `\n   图片：${images}` : ""
    }`;
  });

  return {
    text: `最近 ${matched.length} 条生成记录（全部 ${history.records.length} 条）：\n${lines.join("\n")}`,
    data: {
      total: history.records.length,
      records: matched.map((record) => ({
        id: record.id,
        mode: record.mode,
        status: record.status,
        prompt: record.prompt,
        negative: record.negative,
        params: record.params,
        images: record.images.map((image) => image.path ?? image.url ?? null),
        createdAt: record.createdAt,
        error: record.error ?? null,
      })),
    },
  };
}

/* ------------------------------------------------------------ 分发 */

async function runTool(tool: string, args: ToolArgs): Promise<ToolOutcome> {
  switch (tool) {
    case "mashiro_generate_image":
      return runModelTool(args, "text2img");
    case "mashiro_edit_image":
      return runModelTool(args, "img2img");
    case "mashiro_run_workflow":
      return runWorkflowTool(args);
    case "mashiro_list_capabilities":
      return listCapabilities();
    case "mashiro_enhance_prompt":
      return enhance(args);
    case "mashiro_search_prompts":
      return searchPrompts(args);
    case "mashiro_generation_history":
      return generationHistory(args);
    default:
      throw new Error(`未知工具：${tool}。本服务提供的工具见 mashiro_list_capabilities 的说明。`);
  }
}

/* ------------------------------------------------------------ 启动 */

export interface McpBridgeHandlers {
  /** 每次调用结束都会回调一次，用于在设置页展示调用记录 */
  onCall?: (record: McpCallRecord) => void;
}

/**
 * 挂上工具调用监听。
 *
 * 返回的函数用于解除监听：**页面卸载时必须调用**，
 * 否则 Rust 侧仍以为渲染层在等待，工具调用会白等到超时。
 */
export async function startMcpBridge(handlers: McpBridgeHandlers = {}): Promise<() => void> {
  const unlisten = await listenMcpRequests((request: McpRequest) => {
    void handleRequest(request, handlers);
  });
  await mcpReportBridge(true).catch(() => undefined);
  return () => {
    void mcpReportBridge(false).catch(() => undefined);
    unlisten();
  };
}

async function handleRequest(request: McpRequest, handlers: McpBridgeHandlers) {
  const startedAt = Date.now();
  const args = request.args ?? {};
  let record: McpCallRecord;

  try {
    const outcome = await runTool(request.tool, args);
    record = {
      id: request.id,
      tool: request.tool,
      args: summarizeArgs(args),
      at: startedAt,
      durationMs: Date.now() - startedAt,
      ok: true,
      summary: outcome.text.split("\n")[0].slice(0, 160),
    };
    await mcpRespond({
      id: request.id,
      ok: true,
      text: outcome.text,
      data: outcome.data ?? null,
    }).catch(() => undefined);
  } catch (err) {
    const message = describeUnknown(err);
    record = {
      id: request.id,
      tool: request.tool,
      args: summarizeArgs(args),
      at: startedAt,
      durationMs: Date.now() - startedAt,
      ok: false,
      summary: message.slice(0, 200),
    };
    // 失败原因原样交给模型：它多半能据此改参数或转告用户
    await mcpRespond({
      id: request.id,
      ok: false,
      text: `执行失败：${message}`,
      data: null,
    }).catch(() => undefined);
  }

  handlers.onCall?.(record);
}

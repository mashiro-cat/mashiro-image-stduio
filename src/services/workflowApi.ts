/* ==========================================================================
   RunningHub ComfyUI 工作流 API
   /task/openapi/create · /task/openapi/cancel · /openapi/v2/query
   /api/openapi/getJsonApiFormat · /openapi/v2/media/upload/binary
   ========================================================================== */

import type {
  GeneratedImage,
  WorkflowApiConfig,
  WorkflowInput,
  WorkflowNodeRole,
  WorkflowPreset,
} from "../types";
import { NODE_ROLE_META, NODE_ROLE_ORDER } from "../types";
import { ApiError, postMultipartJson, requestJson } from "../platform/http";
import { persistRemote } from "../platform/media";
import { sleep } from "../platform/env";

export type { WorkflowNodeRole };

export interface NodeParam {
  nodeId: string;
  fieldName: string;
  fieldValue: string | number;
}

/** 一次任务里各输入槽位的取值（图片已换算成上传返回的 fileName） */
export interface WorkflowFieldValues {
  /** 文本类槽位：inputId → 文本 */
  texts?: Record<string, string>;
  /** 数值类槽位（seed / steps）：inputId → 数值 */
  numbers?: Record<string, number>;
  /** 图片类槽位：inputId → 上传后的 fileName */
  files?: Record<string, string>;
}

export interface CreateTaskOptions {
  preset: WorkflowPreset;
  values: WorkflowFieldValues;
  /** 追加的节点参数（调用方自行组装） */
  extra?: NodeParam[];
}

export interface TaskState {
  taskId: string;
  status: "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED" | "CREATE" | "CANCELED" | string;
  errorCode?: string;
  errorMessage?: string;
  promptTips?: string;
  results: Array<{ url: string; outputType?: string }>;
}

function normalizeBase(baseUrl: string): string {
  const base = (baseUrl || "https://www.runninghub.cn").trim().replace(/\/+$/, "");
  return base || "https://www.runninghub.cn";
}

function authHeaders(apiKey: string): Record<string, string> {
  if (!apiKey) throw new ApiError("未配置工作流 API Key");
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

/**
 * 组装 nodeInfoList：按输入槽位逐个替换节点参数。
 *
 * 每一项都必须满足「该节点的 inputs 里真的有这个字段名」，否则上游会拒单，
 * 所以字段名与值类型都跟着槽位走（图片是 fileName，种子/步数是数字）。
 */
export function buildNodeInfoList(inputs: WorkflowInput[], values: WorkflowFieldValues): NodeParam[] {
  const list: NodeParam[] = [];
  for (const input of inputs) {
    const nodeId = input.nodeId.trim();
    const fieldName = input.fieldName.trim();
    if (!nodeId || !fieldName) continue;

    let value: string | number | undefined;
    if (input.role === "image") value = values.files?.[input.id];
    else if (input.role === "seed" || input.role === "steps") value = values.numbers?.[input.id];
    else value = values.texts?.[input.id];

    // 图片必须真的有 fileName；文本为空时同样不提交（保留工作流里的默认值）
    if (value === undefined || value === null || value === "") continue;
    list.push({ nodeId, fieldName, fieldValue: value });
  }
  return list;
}

/** 发起任务 */
export async function createTask(
  config: WorkflowApiConfig,
  options: CreateTaskOptions,
): Promise<{ taskId: string; taskStatus: string; promptTips?: string }> {
  const { preset } = options;
  if (!preset?.workflowId) throw new ApiError("请先配置工作流 ID");

  const nodeInfoList = [
    ...buildNodeInfoList(preset.nodes.inputs, options.values),
    ...(options.extra ?? []).filter((param) => param.nodeId && param.fieldName),
  ];
  const body: Record<string, unknown> = {
    apiKey: config.apiKey,
    workflowId: preset.workflowId,
    nodeInfoList,
    addMetadata: config.addMetadata,
  };
  if (preset.instanceType) body.instanceType = preset.instanceType;
  if (preset.accessPassword) body.accessPassword = preset.accessPassword;
  if (config.retainSeconds > 0) body.retainSeconds = config.retainSeconds;

  const raw = await requestJson<{
    code: number;
    msg: string;
    data?: { taskId?: string; taskStatus?: string; promptTips?: string; clientId?: string };
  }>({
    method: "POST",
    url: `${normalizeBase(config.baseUrl)}/task/openapi/create`,
    headers: authHeaders(config.apiKey),
    body,
    timeoutMs: 120_000,
    label: "工作流 · 创建任务",
  }).catch((err: unknown) => {
    throw explainNodeMismatch(err);
  });

  const data = raw.data ?? {};
  if (!data.taskId) throw new ApiError(raw.msg || "任务创建失败：未返回 taskId");
  return {
    taskId: String(data.taskId),
    taskStatus: String(data.taskStatus ?? "QUEUED"),
    promptTips: data.promptTips,
  };
}

/**
 * 把上游的「字段不存在」报错翻译成可操作的提示。
 *
 * `803 NODE_INFO_MISMATCH(nodeId=16, fieldName=text, reason=field_not_found_in_node_inputs)`
 * 的含义是：节点找到了，但节点里没有叫 text 的字段（自定义节点的文本项常叫 value）。
 * 光看这行原文没人知道该怎么办，所以这里补上「去哪儿改」。
 */
function explainNodeMismatch(err: unknown): unknown {
  const message = err instanceof Error ? err.message : String(err);
  if (!/NODE_INFO_MISMATCH|field_not_found_in_node_inputs/i.test(message)) return err;

  const nodeId = /nodeId=([^,)\s]+)/i.exec(message)?.[1] ?? "";
  const fieldName = /fieldName=([^,)\s]+)/i.exec(message)?.[1] ?? "";
  return new ApiError(
    `节点参数不匹配：节点 ${nodeId || "?"} 里没有「${fieldName || "该"}」字段`,
    0,
    message,
    "到「设置 → 工作流渠道」点一次「识别节点」，会自动记录每个节点真实的字段名；也可以在「节点映射」右侧的字段名框里手填该节点 inputs 中的实际字段名（如 value）。",
  );
}

/** 查询任务结果 V2 */
export async function queryTask(config: WorkflowApiConfig, taskId: string): Promise<TaskState> {
  const raw = await requestJson<{
    taskId?: string;
    status?: string;
    errorCode?: string;
    errorMessage?: string;
    promptTips?: string;
    results?: Array<{ url: string; outputType?: string }> | null;
  }>({
    method: "POST",
    url: `${normalizeBase(config.baseUrl)}/openapi/v2/query`,
    headers: authHeaders(config.apiKey),
    body: { taskId },
    timeoutMs: 60_000,
    label: "工作流 · 查询任务结果",
    quiet: true,
  });

  return {
    taskId: String(raw.taskId ?? taskId),
    status: String(raw.status ?? "RUNNING"),
    errorCode: raw.errorCode,
    errorMessage: raw.errorMessage,
    promptTips: raw.promptTips,
    results: raw.results ?? [],
  };
}

/** 取消任务 */
export async function cancelTask(config: WorkflowApiConfig, taskId: string): Promise<void> {
  await requestJson({
    method: "POST",
    url: `${normalizeBase(config.baseUrl)}/task/openapi/cancel`,
    headers: authHeaders(config.apiKey),
    body: { apiKey: config.apiKey, taskId },
    timeoutMs: 30_000,
    label: "工作流 · 取消任务",
  });
}

/** 拉取工作流 JSON（API 格式） */
export async function getWorkflowJson(config: WorkflowApiConfig, workflowId: string): Promise<string> {
  const raw = await requestJson<{ data?: { prompt?: string } }>({
    method: "POST",
    url: `${normalizeBase(config.baseUrl)}/api/openapi/getJsonApiFormat`,
    headers: authHeaders(config.apiKey),
    body: { apiKey: config.apiKey, workflowId },
    timeoutMs: 60_000,
    label: "工作流 · 读取工作流结构",
  });
  const prompt = raw.data?.prompt;
  if (!prompt) throw new ApiError("该工作流未返回可用的 JSON 结构");
  return prompt;
}

/** 上传素材，返回 fileName（工作流节点需要的是 fileName，而非外链） */
export async function uploadAsset(
  config: WorkflowApiConfig,
  file: { fileName: string; mime: string; dataBase64: string },
): Promise<{ fileName: string; downloadUrl?: string; type?: string }> {
  const raw = await postMultipartJson<{
    code: number;
    message?: string;
    data?: { fileName?: string; download_url?: string; type?: string };
  }>({
    url: `${normalizeBase(config.baseUrl)}/openapi/v2/media/upload/binary`,
    headers: { Authorization: `Bearer ${config.apiKey}` },
    fields: [{ name: "file", fileName: file.fileName, mime: file.mime, dataBase64: file.dataBase64 }],
    timeoutMs: 180_000,
    label: "工作流 · 上传素材",
  });

  const data = raw.data;
  if (!data?.fileName) throw new ApiError("素材上传失败：未返回 fileName");
  return { fileName: data.fileName, downloadUrl: data.download_url, type: data.type };
}

/** 轮询任务直到结束 */
export async function pollTask(
  config: WorkflowApiConfig,
  taskId: string,
  hooks: {
    onTick?: (state: TaskState, elapsedMs: number) => void;
    shouldStop?: () => boolean;
  } = {},
): Promise<TaskState> {
  const intervalMs = Math.max(2, config.pollIntervalSec || 4) * 1000;
  const timeoutMs = Math.max(30, config.pollTimeoutSec || 600) * 1000;
  const startedAt = Date.now();

  // 首个查询前稍作等待，避免刚入队即查询
  await sleep(1000);

  for (;;) {
    if (hooks.shouldStop?.()) {
      throw new ApiError("任务已取消");
    }
    const state = await queryTask(config, taskId);
    hooks.onTick?.(state, Date.now() - startedAt);

    if (state.status === "SUCCESS") return state;
    if (state.status === "FAILED" || state.status === "CANCELED") {
      throw new ApiError(state.errorMessage || `任务执行失败（${state.errorCode || state.status}）`);
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new ApiError("任务轮询超时，可稍后在历史记录中查看结果");
    }
    await sleep(intervalMs);
  }
}

/** 把任务结果下载到本地 */
export async function collectResults(state: TaskState): Promise<GeneratedImage[]> {
  const images: GeneratedImage[] = [];
  for (const item of state.results) {
    if (item.url) images.push(await persistRemote(item.url));
  }
  if (!images.length) throw new ApiError("任务成功但未返回图片地址");
  return images;
}

/* ------------------------------------------------------------ 工作流结构分析 */

export interface WorkflowNodeInfo {
  nodeId: string;
  classType: string;
  title: string;
  /** 该节点 inputs 里可写的字段名 */
  fields: string[];
  /** 主要用途，用于列表里的标签展示；没有识别出来时是 unknown */
  role: WorkflowNodeRole | "unknown";
  /**
   * 该节点可能承担的全部角色。一个节点可以同时对应多个映射：
   * 例如 KSampler 既是「采样步数」，也持有「随机种子」。
   */
  roles: WorkflowNodeRole[];
  /**
   * 角色 → 该节点里实际存在的字段名。
   * 请求组装时直接用它，避免把 `text` 硬编码到字段名不叫 `text` 的节点上。
   */
  fieldNames: Partial<Record<WorkflowNodeRole, string>>;
}

interface RawNode {
  class_type?: string;
  /** API 格式是 { 字段名: 值 }；部分导出的结构是 [{ name, label, type }] 描述符数组 */
  inputs?: unknown;
  _meta?: { title?: string };
}

/** 节点 inputs 的字段名清单，兼容对象与描述符数组两种结构 */
export function inputFieldNames(node: RawNode): string[] {
  const inputs = node?.inputs;
  if (Array.isArray(inputs)) {
    return inputs
      .map((item) => (item && typeof item === "object" ? String((item as { name?: unknown }).name ?? "") : ""))
      .filter(Boolean);
  }
  if (inputs && typeof inputs === "object") return Object.keys(inputs as Record<string, unknown>);
  return [];
}

/** inputs 为对象时取其字段值（描述符数组里没有值，返回 undefined） */
function inputValue(node: RawNode | undefined, field: string): string | undefined {
  const inputs = node?.inputs;
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) return undefined;
  const value = (inputs as Record<string, unknown>)[field];
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** 各角色候选字段名的优先级（越靠前越像「该角色要写的那一项」） */
const FIELD_PRIORITY: Record<WorkflowNodeRole, string[]> = {
  positive: ["text", "value", "prompt", "positive_prompt", "positive", "text_g", "string", "caption"],
  negative: ["text", "value", "prompt", "negative_prompt", "negative", "text_l", "string", "caption"],
  image: ["image", "image_path", "image_filename", "filename", "path", "images"],
  seed: ["seed", "noise_seed", "random_seed", "seed_value"],
  steps: ["steps", "step", "sampler_steps", "sample_steps"],
};

/**
 * 在节点已有的字段名里挑出该角色要写的字段名。
 * 先精确匹配，再退让到「包含关键词」，都找不到就返回空串（交给用户填）。
 */
export function pickFieldName(names: string[], role: WorkflowNodeRole): string {
  const lower = names.map((name) => name.toLowerCase());
  for (const want of FIELD_PRIORITY[role]) {
    const hit = lower.indexOf(want);
    if (hit >= 0) return names[hit];
  }
  for (const want of FIELD_PRIORITY[role]) {
    const hit = lower.findIndex((name) => name.includes(want));
    if (hit >= 0) return names[hit];
  }
  return "";
}

/**
 * 解析 ComfyUI API 格式工作流，推断关键节点用途。
 * 用于「一键识别节点映射」，降低配置门槛。
 *
 * 这里只做「建议」，不下结论：真正的映射由用户在设置页点击确认，
 * 未识别出来的节点也允许手动指派（自定义节点的工作流很常见）。
 * 除用途外，还会把每个节点真实的字段名一起带出来 —— 提交任务时
 * `fieldName` 必须是节点 inputs 里存在的名字，否则接口会直接拒单。
 */
export function analyzeWorkflow(workflowJson: string): WorkflowNodeInfo[] {
  let parsed: Record<string, RawNode>;
  try {
    parsed = JSON.parse(workflowJson) as Record<string, RawNode>;
  } catch {
    throw new ApiError("工作流 JSON 解析失败，请确认已导出为 API 格式");
  }

  const nodes: WorkflowNodeInfo[] = Object.entries(parsed)
    .filter(([, node]) => node && typeof node === "object" && node.class_type)
    .map(([nodeId, node]) => {
      const fields = inputFieldNames(node);
      const roles = classifyNodeRoles(node, fields);
      const fieldNames: Partial<Record<WorkflowNodeRole, string>> = {};
      for (const role of roles) {
        const field = pickFieldName(fields, role);
        if (field) fieldNames[role] = field;
      }
      return {
        nodeId,
        classType: String(node.class_type),
        title: String(node._meta?.title ?? node.class_type),
        fields,
        role: roles[0] ?? ("unknown" as const),
        roles,
        fieldNames,
      };
    });

  // 文本节点里「第一个不像负向的」视为正向，其余视为负向
  const textNodes = nodes.filter((node) => node.roles.includes("positive"));
  let seenPositive = false;
  for (const node of textNodes) {
    const field = pickFieldName(node.fields, "positive");
    const value = field ? inputValue(parsed[node.nodeId], field) : undefined;
    // 读不到值时（描述符数组结构）不当作空，交给先后顺序决定
    const looksNegative = /negative|负向|负面/i.test(node.title) || value === "";
    const role: WorkflowNodeRole = !looksNegative && !seenPositive ? "positive" : "negative";
    if (role === "positive") seenPositive = true;
    node.role = role;
    // 文本角色提到最前，标签栏优先展示「正向 / 负向」这类更有信息量的用途
    node.roles = [role, ...node.roles.filter((item) => item !== "positive" && item !== "negative")];
    const textField = pickFieldName(node.fields, role);
    if (textField) node.fieldNames[role] = textField;
  }

  return nodes.sort((a, b) => Number(a.nodeId) - Number(b.nodeId));
}

function classifyNodeRoles(node: RawNode, fields: string[]): WorkflowNodeRole[] {
  const classType = String(node.class_type);
  const lower = fields.map((field) => field.toLowerCase());
  const has = (...names: string[]) => names.some((name) => lower.includes(name));
  const roles: WorkflowNodeRole[] = [];

  if (/LoadImage|LoadImages|VHS_LoadImages/i.test(classType) || has("image")) roles.push("image");
  // 采样器通常同时持有 steps 与 seed，两者都是可映射的目标
  if (/Sampler/i.test(classType)) roles.push("steps");
  else if (has("steps", "step", "sampler_steps")) roles.push("steps");
  if (has("seed", "noise_seed", "random_seed")) roles.push("seed");
  if (/CLIPTextEncode|Text|String|Prompt/i.test(classType) || has("text", "prompt", "value", "string")) {
    roles.push("positive");
  }

  return roles;
}

/**
 * 从分析结果生成输入槽位建议。
 *
 * 规则：
 * - **图片节点全部纳入**（图生图常有多个 `LoadImage`，每个都需要单独喂图）；
 * - 文本 / 种子 / 步数各只取第一个候选，多出来的交给用户在设置页手动加，
 *   避免自动填一堆卡片把界面冲垮。
 */
export function suggestWorkflowInputs(nodes: WorkflowNodeInfo[]): WorkflowInput[] {
  const make = (role: WorkflowNodeRole, node: WorkflowNodeInfo, seq: number): WorkflowInput => {
    const fieldName = node.fieldNames[role] || pickFieldName(node.fields, role) || NODE_ROLE_META[role].defaultField;
    const base = NODE_ROLE_META[role].label;
    return {
      id: `suggest:${role}:${node.nodeId}`,
      role,
      nodeId: node.nodeId,
      fieldName,
      label: seq === 1 ? base : `${base} ${seq}`,
    };
  };

  /** 优先取明确识别出该角色的节点，否则退而取「可能承担该角色」的第一个节点 */
  const pick = (role: WorkflowNodeRole) =>
    nodes.find((node) => node.role === role) ?? nodes.find((node) => node.roles.includes(role));

  const result: WorkflowInput[] = [];
  for (const role of NODE_ROLE_ORDER) {
    if (role === "image") {
      const imageNodes = nodes.filter((node) => node.roles.includes("image"));
      imageNodes.forEach((node, index) => result.push(make(role, node, index + 1)));
      continue;
    }
    const hit = pick(role);
    if (hit) result.push(make(role, hit, 1));
  }
  return result;
}

/** 该预设是否包含图片输入槽位 */
export function hasImageInput(preset: WorkflowPreset | undefined): boolean {
  return Boolean(preset?.nodes.inputs.some((input) => input.role === "image" && input.nodeId.trim()));
}

/** 工作流 API 连通性自检 */
export async function testWorkflowApi(config: WorkflowApiConfig, workflowId: string): Promise<string> {
  await getWorkflowJson(config, workflowId);
  return "连通正常，已成功读取工作流结构";
}

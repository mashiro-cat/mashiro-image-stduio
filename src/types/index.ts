/* ==========================================================================
   领域模型定义
   ========================================================================== */

/** 生成模式 */
export type GenMode = "text2img" | "img2img" | "workflow";

/**
 * 尺寸的「自动」取值。
 * 不指定具体像素，由模型按提示词自行决定比例——OpenAI Images 协议里
 * size 的取值之一，且 size 本身可选，所以上游不接受 "auto" 时还可以整个省掉。
 */
export const AUTO_SIZE = "auto";

/** 生成任务状态 */
export type TaskStatus = "idle" | "queued" | "running" | "success" | "failed" | "canceled";

/* ------------------------------------------------------------ 密钥 / 配置 */

/** 生图接口的返回格式：
 *  - b64_json：接口直接返回 base64，客户端解码后落盘（推荐，不依赖会过期的外链）
 *  - url：接口返回可下载链接，客户端再拉取一次
 */
export type ImageResponseFormat = "url" | "b64_json";

/**
 * 渠道集合。
 * 生图模型与工作流都支持配置多个渠道：
 *  - 只有 enabled 且已填写密钥的渠道会参与生图；
 *  - activeId 指向工作台当前使用的渠道（工作台只能选已启用的渠道）。
 */
export interface ChannelGroup<C> {
  activeId: string;
  channels: C[];
}

/** 生图模型渠道（OpenAI Images 协议：/v1/images/generations 与 /v1/images/edits） */
export interface ModelApiConfig {
  id: string;
  name: string;
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  /** 默认模型名，例如 gpt-image-2 */
  model: string;
  /** 可选模型列表，用于工作台切换 */
  modelOptions: string[];
  quality: ImageQuality;
  /** 返回格式，工作台统一跟随此配置 */
  responseFormat: ImageResponseFormat;
  /** 请求超时（秒） */
  timeoutSec: number;
}

export type ImageQuality = "auto" | "high" | "medium" | "low";

/** 工作流输入的角色（决定工作台用什么控件、值是什么类型） */
export type WorkflowNodeRole = "positive" | "negative" | "image" | "seed" | "steps";

/**
 * 每个角色的展示元数据（顺序即 UI 顺序）
 *
 * ⚠️ **`label` 是数据不是文案**：它会被 `relabelInputs()` 拼成「输入图片 2」
 * 并**持久化进工作流预设的 `nodes.inputs`**。所以这里必须保持稳定的英文/中文
 * 原文，绝不能写成 `t(...)` 的结果——否则切一次语言就把用户已存好的配置改写掉。
 *
 * 展示时用 `nodeRoleLabel(role)`，它在渲染期按当前语言翻译。
 */
export const NODE_ROLE_META: Record<
  WorkflowNodeRole,
  { label: string; short: string; icon: string; defaultField: string }
> = {
  positive: { label: "正向提示词", short: "正", icon: "type", defaultField: "text" },
  negative: { label: "负向提示词", short: "负", icon: "filter", defaultField: "text" },
  image: { label: "输入图片", short: "图", icon: "image", defaultField: "image" },
  seed: { label: "随机种子", short: "种", icon: "refresh", defaultField: "seed" },
  steps: { label: "采样步数", short: "步", icon: "slider", defaultField: "steps" },
};

/** 角色 → 词条键。与 NODE_ROLE_META.label 一一对应，值本身是数据、这里只存映射 */
export const NODE_ROLE_LABEL_KEYS: Record<WorkflowNodeRole, string> = {
  positive: "workflow.role.positive",
  negative: "workflow.role.negative",
  image: "workflow.role.image",
  seed: "workflow.role.seed",
  steps: "workflow.role.steps",
};

export const NODE_ROLE_ORDER: WorkflowNodeRole[] = ["positive", "negative", "image", "seed", "steps"];

/**
 * 工作流对外暴露的一个可填输入 = 某个节点上的某个字段。
 *
 * 用「列表」而不是「每个角色一个槽位」是因为工作流里同一角色可能有多个节点：
 * 图生图可以有 2~3 个 `LoadImage`，SDXL 也可以有多个文本编码节点，各自需要独立填值。
 */
export interface WorkflowInput {
  id: string;
  role: WorkflowNodeRole;
  nodeId: string;
  /** 该节点里接收这个值的字段名（`LoadImage` 一般是 image，`KSampler` 是 seed / steps） */
  fieldName: string;
  /** 同名角色出现多个时的区分名，例如「输入图片 2」 */
  label: string;
}

/**
 * RunningHub 工作流节点映射：一份「可填输入」清单。
 *
 * **nodeId + fieldName 必须成对正确**：接口按 `nodeId` 找到节点后，
 * 要求 `fieldName` 是该节点 `inputs` 里真实存在的字段名，否则报
 * `NODE_INFO_MISMATCH(... reason=field_not_found_in_node_inputs)`。
 * 「识别节点」会把每个节点真实的字段名写进槽位。
 */
export interface WorkflowNodeMap {
  inputs: WorkflowInput[];
}

/** 单个工作流预设 */
export interface WorkflowPreset {
  id: string;
  name: string;
  workflowId: string;
  /** 工作流加密访问密码 */
  accessPassword: string;
  instanceType: "default" | "plus" | "ultra";
  nodes: WorkflowNodeMap;
  note: string;
}

/** 工作流渠道（RunningHub OpenAPI），每个渠道自带一套工作流预设 */
export interface WorkflowApiConfig {
  id: string;
  name: string;
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  /** 轮询间隔（秒） */
  pollIntervalSec: number;
  /** 轮询超时（秒） */
  pollTimeoutSec: number;
  /** 是否写入元信息 */
  addMetadata: boolean;
  /** 实例保留时长（秒，0 表示不设置） */
  retainSeconds: number;
  presets: WorkflowPreset[];
}

/** LLM 模型 API（openai-completions 协议：/chat/completions） */
export interface LlmConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  /** 最大输出 token */
  maxTokens: number;
  timeoutSec: number;
  /**
   * 关闭思考模式（请求体带 enable_thinking:false）。
   * 推理类多模态模型（Qwen3-VL / GLM-4.5V 等）默认会先输出思考过程，
   * 正文可能整段落在 reasoning_content 里，导致增强拿不到结果——默认关闭。
   */
  disableThinking: boolean;
  /** 用 response_format 强制 JSON 输出；上游不认该字段时会自动去掉重试 */
  jsonMode: boolean;
  /** 增强时把参考图一并交给多模态模型理解（纯文本模型请关闭） */
  sendImages: boolean;
  /** 追加在系统提示词之后的增强要求（留空则只用内置规则） */
  systemPrompt: string;
}

/** 应用偏好 */
export interface AppSettings {
  theme: "light" | "dark";
  /** 界面语言：`system` = 跟随系统（首次启动的默认值） */
  locale: "system" | "zh-CN" | "en-US";
  /** 无密钥时使用内置演示数据，方便体验完整流程 */
  demoMode: boolean;
  defaultSize: string;
  defaultCount: number;
  defaultStyle: string;
  autoSaveHistory: boolean;
  /** 单次生成的图片自动落盘 */
  persistImages: boolean;
}

/** 调试与排错 */
export interface DebugConfig {
  /** 开启后记录完整请求与响应（含请求体、响应体、请求头） */
  enabled: boolean;
  /** 是否记录请求体 / 响应体（可能较大） */
  captureBody: boolean;
  /** 是否记录请求头（密钥类字段自动脱敏） */
  captureHeaders: boolean;
  /** 内存中保留的完整日志条数 */
  maxEntries: number;
}

/** 一条请求日志 */
export interface DebugLogEntry {
  id: string;
  at: number;
  /** 业务来源，例如「文生图 · generations」 */
  source: string;
  method: string;
  url: string;
  status: number;
  ok: boolean;
  durationMs: number;
  /** 本次请求设置的超时时间 */
  timeoutMs?: number;
  /** 是否为调试模式下的完整记录（含请求头与请求体） */
  verbose: boolean;
  /** 请求体是否被截断 */
  truncated?: boolean;
  requestHeaders?: Record<string, string>;
  requestBody?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  error?: string;
  /** 针对常见错误码给出的排查建议 */
  hint?: string;
}

export interface SettingsState {
  modelApi: ChannelGroup<ModelApiConfig>;
  workflowApi: ChannelGroup<WorkflowApiConfig>;
  llm: LlmConfig;
  app: AppSettings;
  debug: DebugConfig;
}

/* ------------------------------------------------------------ 提示词 */

export interface StructuredPrompt {
  subject: string;
  scene: string;
  style: string;
  lens: string;
  lighting: string;
  color: string;
  negative: string;
}

export interface PromptItem {
  id: string;
  title: string;
  content: string;
  negative: string;
  /** 分类，例如「人像」「场景」「产品」 */
  category: string;
  tags: string[];
  favorite: boolean;
  /** 使用次数 */
  usageCount: number;
  structured?: StructuredPrompt;
  source: "manual" | "enhanced" | "builtin" | "history" | "repo";
  /** 来源仓库（owner/name），仅 source=repo 时有值 */
  repo?: string;
  /** 仓库内的稳定标识，重新拉取时用它做原地更新 */
  sourceKey?: string;
  /** 原推 / 仓库文档链接，方便回看参考图 */
  sourceUrl?: string;
  /** 案例效果图（仓库直链，最多 3 张） */
  images?: string[];
  /** 案例作者（X / GitHub 账号） */
  author?: string;
  createdAt: number;
  updatedAt: number;
}

/** 提示词仓库的拉取记录（用于在面板上展示「上次拉取」） */
export interface PromptRepoRecord {
  /** 对应 PROMPT_SOURCES 的 id */
  id: string;
  lastPulledAt: number;
  /** 最近一次拉取中新增 / 更新的条数 */
  added: number;
  updated: number;
  /** 本地当前属于该来源的条数 */
  total: number;
}

/* ------------------------------------------------------------ 生成记录 */

export interface GeneratedImage {
  id: string;
  /** 本地文件绝对路径（已落盘时） */
  path?: string;
  /** 远端地址（未落盘或落盘前） */
  url?: string;
  /** data URL（兜底展示） */
  dataUrl?: string;
  width?: number;
  height?: number;
  revisedPrompt?: string;
}

export interface HistoryRecord {
  id: string;
  mode: GenMode;
  /**
   * 图片来源。
   * - model：大模型生图（OpenAI Images 协议）
   * - workflow：工作流生图（RunningHub ComfyUI）
   * - upscale：本地超分产物（不是「生成」，但同样会落一张图进历史）
   */
  provider: "model" | "workflow" | "upscale";
  status: TaskStatus;
  prompt: string;
  negative: string;
  /** 结构化提示词快照 */
  structured?: StructuredPrompt;
  params: {
    model?: string;
    /** 实际使用的渠道名称（多渠道场景便于回溯） */
    channel?: string;
    size?: string;
    count?: number;
    quality?: ImageQuality;
    seed?: number;
    steps?: number;
    strength?: number;
  };
  /** 输入参考图（图生图） */
  inputImages?: string[];
  images: GeneratedImage[];
  /** 工作流任务 ID */
  taskId?: string;
  workflowName?: string;
  error?: string;
  durationMs?: number;
  favorite: boolean;
  /** 用户自定义标签，跨相册筛选时用 */
  tags?: string[];
  /** 所属相册 id（空表示未归档） */
  collectionId?: string;
  createdAt: number;
}

/* ------------------------------------------------------------ 提示词增强 */

export interface EnhanceResult {
  /** 增强后的正向提示词 */
  prompt: string;
  /** 负向提示词 */
  negative: string;
  structured: StructuredPrompt;
  /** 中文解释，便于用户理解改了哪些方向 */
  notes: string[];
}

export interface EnhanceOptions {
  /** 目标风格 */
  style: string;
  /** 输出语言 */
  language: "en" | "zh";
  /** 是否输出结构化分解 */
  structured: boolean;
  /** 参考图（图生图时辅助理解） */
  hasReference?: boolean;
}

/* ------------------------------------------------------------ UI */

export interface ToastItem {
  id: string;
  type: "success" | "error" | "info" | "warning";
  title: string;
  message?: string;
  /** 可选操作按钮：debug → 打开请求日志，settings → 跳转密钥中心 */
  action?: { label: string; kind: "debug" | "settings" };
}

export interface SelectOption {
  label: string;
  value: string;
  hint?: string;
}

/* ------------------------------------------------------------ MCP 服务 */

/**
 * MCP 服务的运行时状态（由 Rust 侧进程持有，不是本地偏好）。
 *
 * 服务把本应用的生图能力以 MCP 协议暴露给外部 Agent 客户端；
 * 协议与监听在 Rust，真正的生图仍走前端的 `services/mcpBridge.ts`。
 */
export interface McpStatus {
  running: boolean;
  port: number;
  url: string;
  token: string;
  /** 渲染层是否已挂上监听：为 false 时工具调用会在等待超时后报错 */
  bridgeReady: boolean;
  startedAt: number;
  requestCount: number;
  callCount: number;
  lastRequestAt: number;
  lastError: string;
  /** 对外暴露的工具数 */
  toolCount: number;
  serverName: string;
  version: string;
}

/** 一个可一键配置的 Agent 客户端 */
export interface McpClientInfo {
  id: string;
  name: string;
  /** 磁盘上发现了该客户端（配置目录或配置文件存在） */
  detected: boolean;
  /** 配置文件里已经有本应用的条目 */
  configured: boolean;
  path: string;
  exists: boolean;
  note: string;
  homepage: string;
  /** 该客户端只支持 stdio，写入的是 npx 桥接配置 */
  stdioBridge: boolean;
  /** 将要写入的配置片段 */
  preview: string;
}

export interface McpApplyResult {
  path: string;
  message: string;
}

/** 本服务对外暴露的一个工具（界面展示用，与服务端 schema 同源） */
export interface McpToolBrief {
  name: string;
  title: string;
  description: string;
}

/** 一次由外部客户端触发的工具调用（只存在内存里，用于设置页展示） */
export interface McpCallRecord {
  id: string;
  tool: string;
  /** 参数摘要，单行 */
  args: string;
  at: number;
  durationMs: number;
  ok: boolean;
  /** 结果摘要 / 失败原因 */
  summary: string;
}

![preview](preview/mashiro_studio_cn.png)

# Mashiro Studio · AI 生图工作台

一款面向创作者桌面端 AI 生图工作台：把「提示词编辑 → 参数调节 → 图像生成 → 归档复用」整条链路收进一个界面。

技术栈：**Tauri 2 + Vue 3 + TypeScript + Vite + Pinia + Vue Router**。
---

## 功能总览

| 模块 | 说明 |
| --- | --- |
| **首页仪表盘** | 四个创作入口、统计卡与最近创作；**灵感推荐**从提示词库里随机捞取**带案例图**的条目（可「换一批」，点开先看大图与完整提示词再决定是否去生图），库里一条带图的都没有时退回分类卡片并引导拉取仓库 |
| **大模型生图** | 一个工作台两种模式，顶部子 tab 切换。**文生图**：三栏工作台（参数 / 画布 / 提示词），支持风格预设、比例、画质、多图生成；**图生图**：左侧上传 1–4 张参考图（点击或拖拽）后调用 Images `edits` 接口改写。两者共用同一套模型与上游接口，切换模式不会清空画布结果 |
| **工作流生图** | RunningHub ComfyUI 工作流：顶部选渠道与工作流（可搜索），左侧**按该工作流的输入槽位动态生成**表单（提示词 / 多个图片节点 / 种子 / 步数），任务轮询、结果自动落盘、支持取消 |
| **提示词保存与管理** | 提示词库 CRUD、分类、标签、收藏、使用计数、导入 / 导出 JSON、一键送去生图 |
| **提示词智能增强** | 通过 LLM（openai-completions 协议）把一句话扩写为完整提示词，输出结构化拆解与负向词；图生图时把参考图一并交给**多模态**模型，结果给「增强前/后」对比，确认采纳后才替换原提示词 |
| **提示词反推（看图写词）** | 与增强方向相反：让多模态 LLM 观察参考图 / 历史结果，倒推出一条能复现它的提示词；记录没有图片时按生成参数复盘。两个入口分别在**图生图工作台的增强页**和**历史记录详情抽屉**，结果同样先看后采纳，采纳后填入工作台 |
| **风格预设中心** | 风格预设是**可编辑的持久化数据**（设置 → 预设中心），不再是硬编码常量：每条是「英文风格片段 + 可选配套负向词」，选中后追加到正向／负向提示词末尾，改这里工作台风格格子立刻跟着变。内置风格只是首次启动的种子（`promptEnhance.STYLE_PRESETS`），可改可删，「恢复内置」能补回来。**尺寸／数量／画质等机器参数不进预设**——它们由工作台草稿自动记住上次用的值 |
| **生图历史记录** | 按日期分组、多维筛选、详情抽屉、复用参数、下载 / 打开文件位置、清理失败记录；可**按相册归档**（相册只存名字，封面由组内首图派生）、**按标签跨相册筛选**，并支持批量选中后归入相册 / 加标签 / 删除 |
| **结果文件定位** | 两个工作台的画布工具栏与历史记录（卡片快捷按钮 / 详情抽屉）都可一键在系统文件管理器中定位对应图片 |
| **本地 AI 超分** | 侧边栏「创作 → 图片超分」独立页面：拖入 / 选择 / 从历史记录一键送图，批量放大并**并排对比「原图 → 放大后」**与标注尺寸。推理内置在本机（ONNX Runtime），**完全离线**，不上传图片也不消耗接口额度。模型按需下载（设置 → 扩展能力 → 本地超分），产物登记进历史记录。分块推理 + 羽化融合避免拼接接缝。**有显卡可开启 GPU 加速**（DirectML，NVIDIA/AMD/Intel 通吃），实测 RTX 3060 Ti 约快 1.2 倍；开启后若 GPU 不可用会自动回退 CPU，不会让功能变得不可用 |
| **密钥配置中心** | 生图模型 API Key、工作流 API Key、LLM 模型 Key 三套独立配置 + 连通性自检 |
| **MCP 服务** | 一键把生图能力按 MCP 协议暴露给外部 Agent（Codex / Kimi Code / WorkBuddy / Claude Code / Cursor / VS Code），带访问令牌、启停开关与调用记录 |
| **调试与排错** | 可开关的请求日志：记录发送数据、返回数据与响应头，密钥自动脱敏；内置常见错误码排查建议 |

---

## 快速开始

```bash
pnpm install          # 安装依赖
pnpm dev              # 浏览器预览（无需密钥即可体验，走演示模式）
pnpm tauri dev        # 桌面端开发
pnpm tauri build      # 打包桌面应用
```

未配置任何密钥时进入**演示模式**：生成的是渐变占位图，但完整流程（增强、入库、历史、复用）都可正常体验。在「密钥中心」填入 Key 后自动切换为真实调用。

---

## 三套密钥如何配置

### 1. 生图模型 API

遵循 OpenAI Images 协议：

- 文生图 `POST {baseUrl}/v1/images/generations`
- 图生图 `POST {baseUrl}/v1/images/edits`（`multipart/form-data`）

填写 `Base URL`（如 `https://xxx.xx/xx`）、`API Key`、默认模型（如 `gpt-image-2`）与可选模型列表即可。该协议没有独立的负向提示词字段，程序会以 `Avoid the following elements: ...` 约束句追加。

**返回格式**默认 `base64`（请求体 `response_format: "b64_json"`）：接口直接把图片数据返回给客户端，客户端按真实文件头（PNG / JPEG / WEBP / GIF / BMP / SVG）判断格式后**解码还原成图片并落盘**，不依赖上游可能随时过期的临时外链，也少一次下载请求。也可在密钥中心切换为「图片链接」模式，由客户端再拉取一次。文生图、图生图与连通测试统一使用该配置，工作台不再单独设置。

支持的尺寸：`1024x1024`、`1536x1024`、`1024x1536`、`2048x2048`、`2048x1152`、`3840x2160`、`2160x3840`。

### 2. 工作流 API（RunningHub）

- 提交任务 `POST {baseUrl}/task/openapi/create`
- 查询结果 `POST {baseUrl}/openapi/v2/query`
- 读取结构 `POST {baseUrl}/api/openapi/getJsonApiFormat`
- 素材上传 `POST {baseUrl}/openapi/v2/media/upload/binary`
- 取消任务 `POST {baseUrl}/task/openapi/cancel`

每个「工作流预设」包含 `workflowId`、实例类型、访问密码与一份 **输入槽位（inputs）** 清单。点 **识别节点** 可拉取工作流 JSON、自动推断节点用途并生成槽位，无需手工翻节点 ID。

#### 输入槽位：工作台有什么，取决于这个工作流

工作流之间的差异很大，所以工作台不写死表单，而是**按预设里的输入槽位动态渲染**：槽位是「某个节点上的某个字段」，一个槽位对应工作台里的一个控件。

| 槽位角色 | 控件 | 提交的值 |
| --- | --- | --- |
| `positive` / `negative` | 多行输入框 | 文本 |
| `image` | 单图上传位（拖拽 / 点选，可更换、可移除） | 上传接口返回的 `fileName` |
| `seed` / `steps` | 数字输入框（种子带随机按钮） | 数字 |

- **同一个角色可以有多个槽位**：图生图常有 2~3 个 `LoadImage`，识别节点会把它们**全部**收进来，工作台上每个图片节点各有一个上传位；SDXL 的多个文本编码节点同理，识别会先给一个，其余用短标签手动补。
- 槽位支持手工增删：识别结果每行右侧的 `正 负 图 种 步` 标签点一下加、再点一下减；也可以在「设置 → 输入槽位」里直接添加空槽位、改节点 ID 与字段名。
- 留空的槽位不会提交，工作流会沿用里面的默认值。

#### 图片输入按接口文档对接

图片走的是「先上传拿 `fileName`，再把它写进节点」两步，**不是外链**：

```json
// 1) POST {baseUrl}/openapi/v2/media/upload/binary  (multipart，字段名 file)
{ "code": 0, "message": "success", "data": { "type": "image", "fileName": "openapi/6143….png", "download_url": "…", "size": "3490" } }

// 2) 每个图片节点各写一条
"nodeInfoList": [
  { "nodeId": "5", "fieldName": "image",  "fieldValue": "openapi/6143….png" },
  { "nodeId": "9", "fieldName": "upload", "fieldValue": "openapi/9d77….zip" }
]
```

文档里 `LoadImage` 用 `image`、`LoadImages(zip)` 用 `upload`、`LoadAudio` 用 `audio`、`LoadVideo` 用 `video` —— 这些差异都由**槽位自己的字段名**承载，所以换节点类型不用改代码。多个图片槽位会**逐个上传**，各自拿到自己的 `fileName`。

#### 字段名（fieldName）不能硬编码

提交任务的 `nodeInfoList` 里，每一项是 `{ nodeId, fieldName, fieldValue }`。接口先按 `nodeId` 找到节点，**再按 `fieldName` 取该节点的 input**——名字对不上会直接拒单：

```json
{ "code": 803, "msg": "NODE_INFO_MISMATCH(nodeId=16, fieldName=text, reason=field_not_found_in_node_inputs)" }
```

自定义节点的文本项常叫 `value` 而不是 `text`，高级采样器的种子叫 `noise_seed` 而不是 `seed`，所以字段名必须来自工作流 JSON 里该节点 `inputs` 的真实名字（`inputs` 为对象时取键名，为描述符数组时取每项的 `name`）。「识别节点」会把每个节点的真实字段名一并写进槽位；**每个槽位右侧的小输入框**显示并可手动修改它。万一还是撞上 803，客户端会把报错翻译成「哪个节点缺哪个字段、去哪儿改」。

### 3. LLM 模型 API（openai-completions）

- `POST {baseUrl}/v1/chat/completions`，鉴权 `Authorization: Bearer <key>`
- 请求体包含 `model` / `messages` / `temperature` / `max_tokens` / `stream: false`
- **`enable_thinking: false`**：默认关闭思考模式。推理类多模态模型（Qwen3-VL / GLM-V / DeepSeek 等）不关思考时，正文会整段落进 `reasoning_content`、`content` 为空，增强拿不到结果——所以默认关掉；万一上游不接受该字段，会自动摘掉再试一次。
- `response_format: {"type":"json_object"}` 同样可关（设置页「JSON 输出约束」）；上游报「不认这个参数」时会自动去掉该字段重试，返回内容仍做容错解析（兼容 ```json 包裹与前后缀文本）。
- 上游只收 `max_completion_tokens`（新版 OpenAI 模型）时报错提到 `max_tokens`，会自动换名重试。
- 若最终 `content` 仍为空（思考模式没关掉），会回退用 `reasoning_content`，并从思考内容里提取 JSON。

**多模态增强（只在图生图时带图）**：图生图场景下，工作台的参考图会随请求一起发给模型，走标准多模态消息
`content: [{type:"text"},{type:"image_url",image_url:{url:"data:image/jpeg;base64,..."}}]`（最多 4 张；超过 1.5MB 的位图先缩到 1024px 并转 JPEG，矢量图直接跳过）。设置页可关闭「发送参考图」以适配纯文本模型。

「当前是不是图生图」由调用方**显式传入**（`enhance(withReferences)`），不去读草稿：草稿里的参考图是持久化的，文生图时它们只是上一次留下的数据（提交生图时也并不会用到）。早期版本直接读草稿，导致文生图的增强请求里混进了几张图片 data URL。面板上的参考图数量与文案走同一口径，文生图固定显示「当前没有参考图，仅发送文本」。

**增强怎么增强**由系统提示词控制：信息顺序（主体 → 动作 → 服饰 → 环境 → 构图 → 光线 → 色彩 → 风格 → 画质）、长度（正向 60~110 词）、输出语言、参考图的使用方式、以及必须返回的 JSON 结构都写在里面；设置页可以追加自定义要求（优先级高于通用规则）。其中「随消息附带的图片」这段（`VISION_SECTION`）**只在真的带了图时才拼接**——文生图的请求体里不会出现任何图片相关字样，免得模型以为「应该有图却没收到」。

增强结果包含：正向提示词、负向提示词、六维结构化拆解（主体 / 场景 / 风格 / 镜头 / 光线 / 色彩）与改动说明。结果**不会自动覆盖**原提示词：给出「增强前 → 增强后」全文对比与「采纳并替换原提示词 / 放弃」动作，采纳后才写入工作台并标记「已采纳」。

这套结果展示由 `components/workbench/EnhanceResult.vue` 统一提供，**「大模型生图」的提示词面板与「工作流生图」的正向提示词槽位共用**（后者动作条不吸底、随左栏滚动），两处都能看到完整结果后再决定是否采纳。工作流里多正向槽位时，增强只作用于与工作台共用的那一个槽位。

---

## 把生图能力接给外部 Agent（MCP 服务）

「设置 → 扩展能力 → MCP 服务」可以把本应用变成一个 **MCP 服务器**，让 Codex、Kimi Code、WorkBuddy、Claude Code、Cursor 这类 Agent 客户端直接调用它的生图能力——你在客户端里说「生成一张赛博朋克风格的雨夜街拍，竖构图」，图就出来了，而且落盘的路径会回到 Agent 手里继续用。

服务默认关闭，打开开关即开始监听：

```
http://127.0.0.1:8737/mcp        # Streamable HTTP（POST），端口可改
Authorization: Bearer <访问令牌>
```

### 提供的工具

| 工具 | 作用 |
| --- | --- |
| `mashiro_generate_image` | 文生图（提示词 / 负向词 / 画幅 / 张数 / 模型 / 画质 / 风格预设） |
| `mashiro_edit_image` | 图生图，参考图用本地路径或 http(s) 链接传入，最多 4 张 |
| `mashiro_run_workflow` | 跑设置里配好的 RunningHub 工作流，按输入槽位填提示词 / 图片 / 种子 / 步数 |
| `mashiro_list_capabilities` | 列出可用渠道、模型、工作流与它们的输入槽位、可选尺寸画质风格 |
| `mashiro_enhance_prompt` | 用配置的 LLM 把一句话扩写成完整提示词 |
| `mashiro_search_prompts` | 检索本机提示词库 |
| `mashiro_generation_history` | 读取最近的生成记录（含结果文件路径） |

工具返回的是**图片的本地绝对路径**——结果已落盘，Agent 可以直接读取或继续拿去图生图，不依赖任何会过期的远端链接。每次通过 MCP 生成的记录都会写进历史记录，渠道名后面带 `· MCP` 标记。

### 一键配置到客户端

面板里列出常见客户端，点「写入配置」即可把服务地址与令牌写进它的配置文件；已存在的配置**就地更新**，首次改写前会留一份 `.mashiro.bak` 备份。

| 客户端 | 写入位置 | 备注 |
| --- | --- | --- |
| WorkBuddy | `~/.workbuddy/mcp.json` | 写好后要在「连接器管理」里点一次**信任** |
| Codex CLI | `~/.codex/config.toml` | 同时放宽 `tool_timeout_sec`（生图慢，默认 60 秒会提前断开） |
| Claude Code | `~/.claude.json` | 也可改用 `claude mcp add --transport http` |
| Kimi Code CLI | `~/.kimi-code/mcp.json`（或 `~/.kimi/mcp.json`） | TUI 里用 `/mcp` 看连接状态 |
| Cursor | `~/.cursor/mcp.json` | 全局生效 |
| VS Code | `%APPDATA%\Code\User\mcp.json` | 根键是 `servers` 而不是 `mcpServers` |
| Claude Desktop | `claude_desktop_config.json` | 只支持 stdio，写入的是 `npx mcp-remote` 桥接配置，需要本机有 Node.js |

没列出来的客户端可以点「复制接入说明」，把地址与令牌粘给任意 Agent 让它自己配。

**MCP 配置不会热加载**：写入后需要重启客户端或新开一个会话，否则它看不到这些工具。

### 安全与成本

- 服务**只监听 `127.0.0.1`**，不接受局域网 / 外部网络连接；每个请求都要带访问令牌（可在面板里轮换）。
- 令牌等于生图额度，别贴到公开的地方；轮换后所有已写入的客户端配置要重新写一次。
- 外部 Agent 调用会**真实消耗**你在应用里配置的渠道额度，并把提示词发给上游。不用的时候关掉服务即可。
- 面板里的「调用记录」会列出外部客户端最近调用过哪些工具、参数摘要与耗时（只保留在内存里）。

---

## 调试与排错

「密钥中心 → 通用与数据 → 调试与排错」可开启**请求日志**。适合处理「上游控制台显示成功、客户端却报错」这类只在某一侧可见的问题。

| 开关 | 作用 |
| --- | --- |
| 调试模式 | 总开关。开启后记录完整请求与响应 |
| 请求数据 | 记录发送的请求体与接口返回体（超长 base64、图片内容自动省略为 `<base64 N 字符已省略>`） |
| 请求头 | 记录请求头与响应头（`Authorization`、`api_key`、`token` 等自动脱敏为 `Bearer sk-abc***1234`） |
| 日志上限 | 内存中保留的条数，默认 120 |

日志入口有三处：顶栏的 **日志** 徽标（带失败条数）、失败提示气泡里的 **查看日志** 按钮、以及设置页的 **查看请求日志** 按钮。抽屉内可逐条展开查看「请求头 / 请求数据 / 响应头 / 返回数据」，也支持单条复制与整体导出 JSON。

**关闭调试模式时依然会记录精简信息**（方法、URL、状态码、耗时、失败原因），因为用户往往是「先遇到失败、再回头开调试」。精简记录足以确认「哪一次请求、耗时多久、返回什么状态码」。

日志写入本机 `store/debug-log.json`，不会上传；导出前所有密钥类字段与 base64 内容都会脱敏。

### 内置的错误码排查建议

日志与错误提示会针对常见状态码直接给出结论，无需自行搜索：

- **524**（Cloudflare 网关超时）：网关在约 100 秒内没等到源站响应就切断了连接。**服务端可能仍在继续生成，但客户端这次已经取不到结果**——上游控制台因此会显示成功。可尝试降低尺寸 / 画质、把生成数量改为 1，或稍后在历史记录与上游控制台核对结果。
- **522 / 523 / 502 / 503 / 504**：上游服务或网关临时不可用，稍后重试。
- **401 / 403**：密钥无效、过期或权限不足，检查密钥中心。
- **404**：Base URL 填成了具体接口地址或多带了路径。
- **413**：参考图或尺寸过大，压缩后重试。
- **429**：触发限流，降低并发。

同时，日志里的**耗时 + 超时设置**可以直接暴露问题：若每次都在 100 秒左右失败、而超时设置是 300 秒，基本可以确认是网关侧（而非应用侧）超时。

---

## 界面预览

`document/preview/` 下附了实际运行截图（浅色 + 深色）：

| 文件 | 内容 |
| --- | --- |
| `home.png` | 首页：创作入口、灵感推荐、统计、最近创作 |
| `text2img.png` / `generate-done.png` | 大模型生图 · 文生图模式与生成结果 |
| `img2img.png` | 大模型生图 · 图生图模式（左侧参考图拖拽上传） |
| `workflow.png` | 工作流生图：输入区按工作流的输入槽位动态生成 |
| `workflow-picker.png` | 工作流选择器（搜索名称 / ID，显示输入项数与实例类型） |
| `settings-workflow-inputs.png` | 工作流输入槽位编辑（节点 ID + 字段名、多个图片节点、手动增删） |
| `enhance.png` | 提示词智能增强结果 |
| `prompts.png` | 提示词库管理 |
| `history.png` | 历史记录（日期分组 + 详情抽屉） |
| `settings.png` | 密钥配置中心 |
| `settings-debug.png` / `debug-log.png` | 调试开关与请求日志详情（含 524 排查建议） |
| `dark-*.png` | 深色主题下的首页 / 工作台 / 密钥中心 / 请求日志 |

---

## 架构说明

```
src-tauri/src/              Rust 侧（自定义命令，无需额外权限位）
  ├─ main.rs                二进制入口，只调用 lib 的 run()
  ├─ lib.rs                 组装层：声明模块 + 注册命令 + 启动 Tauri（不放实现）
  ├─ http/                  出网代理域：reqwest 客户端 + 请求/响应契约
  │    ├─ types.rs          IPC 契约（DTO）
  │    ├─ client.rs         超时策略、响应归一化、错误翻译
  │    └─ commands.rs       http_request / http_multipart
  ├─ fs/                    本地文件域
  │    ├─ paths.rs          数据目录定位 + 路径白名单（安全边界）
  │    └─ commands.rs       读写 / 删除 / 导出
  ├─ system/                系统集成域（调起资源管理器 / 访达）
  ├─ upscale/                本地超分域：ONNX 推理，完全不联网
  │    ├─ model.rs           模型注册表（归一化约定 / 倍数 / 下载源）+ 会话缓存
  │    ├─ inference.rs       分块推理 + 羽化融合（消接缝）
  │    ├─ ep.rs              执行提供器（CPU / DirectML GPU）与可用性探测
  │    └─ commands.rs        能力查询 / GPU 探测 / 下载 / 单张与批量超分
  └─ mcp/                   MCP 服务域：把生图能力暴露给外部 Agent
       ├─ server.rs         回环地址上的极简 HTTP/1.1 服务（只用 std，不引 web 框架）
       ├─ protocol.rs       JSON-RPC 2.0 + MCP 方法分发
       ├─ tools.rs          对外工具清单（schema 即前端契约）
       ├─ bridge.rs         调用 → 渲染层 → 回执 的等待与超时
       ├─ clients.rs        写各客户端配置文件（只认 id，不认路径）
       └─ commands.rs       启停 / 状态 / 客户端配置命令
src/platform/               运行时抽象：Tauri / 浏览器双端适配
  ├─ env.ts                 环境判定、格式化工具
  ├─ http.ts                统一请求层（Tauri → reqwest；浏览器 → fetch）
  ├─ mcp.ts                 MCP 服务命令与工具调用事件
  ├─ debug.ts               日志 sink、URL 精简、密钥脱敏与 base64 省略
  ├─ storage.ts             JSON 持久化 + 文件操作
  └─ media.ts               图片落盘、寻址、下载、尺寸探测
src/services/               业务接口封装
  ├─ modelApi.ts            Images generations / edits
  ├─ workflowApi.ts         RunningHub 任务与节点分析
  ├─ llmApi.ts              chat/completions（多模态消息 + 关闭思考 + 参数降级重试 + JSON 容错解析）
  ├─ promptEnhance.ts       增强 / 反推的系统提示词、多模态消息组装与结果归一化
  ├─ mcpBridge.ts           MCP 工具的执行端（复用上面这些能力）
  ├─ upscale.ts             本地超分（invoke 封装 + 浏览器预览降级）
  └─ demo.ts                演示模式占位图与演示增强 / 反推结果
src/stores/                 Pinia：settings / presets / collections / prompts / history / draft / ui / debugLog / mcp / upscale
src/composables/            useGenerator（生成与轮询编排、超分产物归档）、useWorkbenchActions（增强 / 反推、导入、存库、风格拼装）
src/assets/icons/           首页插图资源（设计交付 PNG），统一由 index.ts 导出语义化 key
src/components/ui/          设计系统原语（图标、弹层、表单、表格、空状态…）
src/components/workbench/   工作台三栏组件
src/components/history/     历史记录的相册栏
src/components/settings/    设置页里的独立面板（MCP 服务 / 本地超分…）
src/components/debug/       请求日志抽屉
src/views/                  首页 / 大模型生图（文生图·图生图）/ 工作流生图 / 图片超分 / 提示词库 / 历史记录 / 密钥中心
src/router/                 studio.ts 提供「生成模式 → 路由」映射，避免各处硬编码路径
```

Rust 侧按「能力」纵切而非按「层」横切：新增功能先判断属于哪个域（出网 / 本地文件 / 系统 / 本地超分 / MCP），再在该域下加文件，不要往 `lib.rs` 里塞实现。命令名与参数名是前端公开契约（`src/platform/http.ts`、`src/platform/storage.ts`、`src/platform/mcp.ts`、`src/services/upscale.ts`），改名必须同步前端；提交前跑 `cargo fmt` 与 `cargo check`。

MCP 域的分工值得单独说一句：**协议与传输在 Rust，生图能力仍在前端**。生图链路（渠道配置、上游协议、结果落盘、历史记录）已经完整地写在 TS 里，在 Rust 里重写一遍只会产出两套会各自漂移的实现。所以 Rust 侧收到 `tools/call` 后，把调用推给渲染层（`src/services/mcpBridge.ts`）执行，再把结果写回客户端；渲染层未就绪时会明确报错，而不是干等到超时。

超分域有两个**必须保留**的技术决定，改动前先读 `src-tauri/src/upscale/mod.rs`：

- **`ort` 必须用 `download-binaries`（静态链接），不能用 `load-dynamic`。** 后者在 Tauri 里必然失败：进程跑在 WebView2 里，而 WebView2 自带一份 `onnxruntime.dll`，Windows 对同名模块只加载一次，`dlopen` 会复用已加载的那份（实测报 `BadVersion { version_str: "1.17.1" }`）。`download-binaries` 在构建期把 ONNX Runtime 下到 `%LOCALAPPDATA%\ort.pyke.io\` 并静态链进二进制，**运行时不需要任何 dll**。代价是首次构建需要联网。
- **模型清单只在 `upscale/model.rs` 一处**，前端一律通过 `upscale_list_models` 问。`ValueRange`（`[0,1]` 还是 `[-1,1]`）必须由每个模型自己声明——Real-ESRGAN 的 ONNX 导出没有统一约定，猜错**不会报错，只会出偏色图**。
- **GPU 加速（DirectML）失败必须回退 CPU，不能报错**。`ep::apply_directml` 的签名是「按值进、返回一个保证可用的 builder」：`with_execution_providers` 会吃掉 `SessionBuilder` 的所有权（它不是 `Copy`），失败时拿不回来，只能重建。驱动版本、虚拟桌面、远程会话都可能让注册失败，这些用户控制不了，不能因此让超分变得不可用。界面会显示 Rust 侧**如实回报的实际后端**，回退了就说 CPU。

路由约定（桌面端用 hash 路由）：

| 路径 | 页面 |
| --- | --- |
| `#/generate?mode=text2img` | 大模型生图 · 文生图 |
| `#/generate?mode=img2img` | 大模型生图 · 图生图 |
| `#/workflow` | 工作流生图 |

`#/text2img` 与 `#/img2img` 作为旧路径保留重定向，历史记录里的「复用参数」、提示词库的「去生图」都通过 `studioRoute(mode)` 统一生成目标地址。

侧栏入口是**不带 `mode` 的裸 `#/generate`**：此时沿用当前模式，不会把图生图悄悄重置成文生图；只有明确带上 `mode=text2img|img2img` 时才切模式。

设计要点：

1. **密钥不出渲染层网络面板**：所有出网请求经 Rust 侧 `http_request` / `http_multipart` 发出，天然绕开 WebView 的 CORS 限制，也不受远端未开 CORS 的影响。
2. **结果即时落盘**：生成成功后立即下载到应用数据目录，历史记录不依赖会过期的远端链接。
3. **跨页交接**：工作台参数统一放在 `draft` store 并持久化，因此「从提示词库去生图」「从历史复用参数」都是无参数跳转，重启后参数仍在。
4. **双端可跑**：`platform` 层在浏览器预览时降级为 fetch + localStorage，便于纯前端调试与演示。
5. **两个工作台保活**：`App.vue` 用 `<KeepAlive :include="WORKBENCH_VIEWS">` 缓存 `ModelStudioView` / `WorkflowView`。切到设置页再切回来，正在跑的任务、画布结果、增强结果、面板 tab 全都不丢；名字以各视图 `defineOptions({ name })` 为准，改名要同步改 `WORKBENCH_VIEWS`。保活后离开页面**只触发 `onDeactivated`**（不再有 `onBeforeUnmount`），所以全局监听要四路注册：`onMounted` / `onActivated` 挂、`onDeactivated` / `onBeforeUnmount` 摘——同一函数引用重复注册会被浏览器忽略，两边都挂是安全的。

### 图标与品牌资源

| 用途 | 来源 | 说明 |
| --- | --- | --- |
| 首页入口 / 统计卡插图 | `src/assets/icons/*.png` | 设计交付的彩色图形，经 `src/assets/icons/index.ts` 导出为 `homeIcons.*`；组件只引用语义化 key，不写带空格的原始文件名 |
| 侧边栏标识、favicon | `src/assets/app_icon.png` → `public/app-icon.png` | 应用内品牌标识与浏览器标签图标 |
| 桌面端安装图标 | `src-tauri/icons/*` | 由同一张 420×420 带透明通道的源图生成 |

更换应用图标时，只需替换 `src/assets/app_icon.png`，然后：

```bash
pnpm tauri icon src/assets/app_icon.png   # 重新生成 src-tauri/icons 全套
```

---

## 本地数据位置

Windows 下位于 `%APPDATA%\com.mashiro.imagegen`：

```
store/settings.json     三套密钥与偏好设置（含调试开关）
store/prompts.json      提示词库
store/presets.json      风格预设
store/collections.json  相册
store/history.json      生成记录（含标签与所属相册）
store/draft.json        工作台草稿
store/debug-log.json    请求日志（用于排错，可随时清空）
store/mcp.json          MCP 服务配置（开关 / 端口 / 访问令牌）
store/upscale.json      本地超分偏好（是否显示入口 / 选用模型）
images/                 已落盘的生成结果
models/                 已下载的超分模型（.onnx，按需下载，可随时删除重下）
```

在「密钥中心 → 通用与数据」可查看路径、打开目录或一键清空全部数据。

---

## 键盘快捷键

| 快捷键 | 作用 |
| --- | --- |
| `Ctrl / ⌘ + Enter` | 在工作台提交生成 |
| `Ctrl / ⌘ + K` | 打开全局搜索（顶栏搜索框） |
| `Esc` | 关闭弹层 / 抽屉 |

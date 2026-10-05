//! 对外暴露的工具清单。
//!
//! **这里的 schema 就是前端契约**：`src/services/mcpBridge.ts` 按同一批工具名分发，
//! 参数名（`prompt` / `size` / `count` / `images`…）两边必须逐字一致。
//! 加工具的顺序是：先在这里声明，再到 `mcpBridge.ts` 实现，最后同步 README 的工具表。
//!
//! 工具名统一加 `mashiro_` 前缀：Agent 侧看到的工具名都是 `mcp__<服务>__<工具>`，
//! 前缀能让模型一眼看出这些工具来自同一处。

use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};

/// 与设置页 `ASPECT_OPTIONS` 保持一致的画幅取值，`auto` 交给模型自己定
const SIZES: [&str; 8] = [
    "auto",
    "1024x1024",
    "1536x1024",
    "1024x1536",
    "2048x2048",
    "2048x1152",
    "3840x2160",
    "2160x3840",
];

const QUALITIES: [&str; 4] = ["auto", "high", "medium", "low"];

/// 文生图 / 图生图 / 工作流生图都可能跑几分钟，超时要比上游本身宽一些；
/// 其余工具只读本地数据，给 60 秒足够。
const LONG_TIMEOUT: Duration = Duration::from_secs(900);
const WORKFLOW_TIMEOUT: Duration = Duration::from_secs(1800);
const QUICK_TIMEOUT: Duration = Duration::from_secs(60);

pub fn definitions() -> Vec<Value> {
    vec![
        json!({
            "name": "mashiro_generate_image",
            "title": "文生图",
            "description": "按提示词生成图片（OpenAI Images 协议）。生成结果会自动落盘并写入应用的历史记录，返回本地文件的绝对路径。耗时通常 30~120 秒，尺寸越大越慢。",
            "annotations": { "title": "文生图", "readOnlyHint": false, "openWorldHint": true },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "prompt": { "type": "string", "description": "画面描述。中英文都可以，英文通常更稳。写得越具体越好：主体、场景、风格、镜头、光线、色彩。" },
                    "negative": { "type": "string", "description": "不希望出现的元素（该协议没有独立的负向字段，会以约束句追加在提示词后）" },
                    "size": { "type": "string", "enum": SIZES, "default": "auto", "description": "画幅。auto 表示不限制，由模型按提示词自行决定比例" },
                    "count": { "type": "integer", "minimum": 1, "maximum": 4, "default": 1, "description": "生成张数。张数越多耗时与额度消耗越大" },
                    "model": { "type": "string", "description": "覆盖当前渠道的默认模型名，需在该渠道的模型列表内；留空用默认" },
                    "quality": { "type": "string", "enum": QUALITIES, "description": "画质，留空跟随渠道配置" },
                    "style": { "type": "string", "description": "风格预设名，如「电影感」「动漫插画」「赛博朋克」，留空不加风格前缀" }
                },
                "required": ["prompt"]
            }
        }),
        json!({
            "name": "mashiro_edit_image",
            "title": "图生图",
            "description": "基于 1~4 张本地参考图改写画面（Images edits 接口）。参考图用本地绝对路径传入，例如上一步 mashiro_generate_image 返回的路径。",
            "annotations": { "title": "图生图", "readOnlyHint": false, "openWorldHint": true },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "prompt": { "type": "string", "description": "希望把参考图改成什么样" },
                    "images": {
                        "type": "array",
                        "items": { "type": "string" },
                        "minItems": 1,
                        "maxItems": 4,
                        "description": "参考图的本地绝对路径（PNG / JPG / WEBP）。多于 1 张时走多图编辑"
                    },
                    "negative": { "type": "string", "description": "不希望出现的元素" },
                    "size": { "type": "string", "enum": SIZES, "default": "auto", "description": "输出画幅" },
                    "count": { "type": "integer", "minimum": 1, "maximum": 4, "default": 1 },
                    "model": { "type": "string", "description": "覆盖默认模型名" },
                    "quality": { "type": "string", "enum": QUALITIES }
                },
                "required": ["prompt", "images"]
            }
        }),
        json!({
            "name": "mashiro_run_workflow",
            "title": "工作流生图",
            "description": "运行用户在 Mashiro Studio 里配置好的 RunningHub（ComfyUI）工作流。先用 mashiro_list_capabilities 查到工作流名称与它的输入槽位。执行时间取决于工作流本身，可能长达十几分钟。",
            "annotations": { "title": "工作流生图", "readOnlyHint": false, "openWorldHint": true },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "workflow": { "type": "string", "description": "工作流预设的名称或 id；留空使用当前激活的那个" },
                    "prompt": { "type": "string", "description": "正向提示词，会写入该工作流的正向文本槽位" },
                    "negative": { "type": "string", "description": "负向提示词，会写入负向文本槽位" },
                    "images": { "type": "array", "items": { "type": "string" }, "description": "图片槽位用的本地图片绝对路径，按槽位顺序依次填入" },
                    "seed": { "type": "integer", "description": "随机种子，留空由工作流决定" },
                    "steps": { "type": "integer", "description": "采样步数，留空由工作流决定" }
                }
            }
        }),
        json!({
            "name": "mashiro_list_capabilities",
            "title": "查看可用能力",
            "description": "列出当前可用的生图渠道、可选模型、工作流预设（含每个工作流的输入槽位）、可选画幅与画质。调用任何生图工具之前先看一眼，能避免猜错模型名或工作流名。",
            "annotations": { "title": "查看可用能力", "readOnlyHint": true },
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "mashiro_enhance_prompt",
            "title": "提示词增强",
            "description": "用应用内配置的 LLM 把一句话扩写成完整提示词，返回正向词、负向词与六维结构化拆解。适合「用户只给了一个模糊想法」的场景，写好后再交给 mashiro_generate_image。",
            "annotations": { "title": "提示词增强", "readOnlyHint": true, "openWorldHint": true },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "prompt": { "type": "string", "description": "用户的原始想法" },
                    "negative": { "type": "string", "description": "已有的负向提示词" },
                    "style": { "type": "string", "description": "目标风格，如「电影感」「水彩手绘」" },
                    "language": { "type": "string", "enum": ["en", "zh"], "default": "en", "description": "输出提示词的语言" }
                },
                "required": ["prompt"]
            }
        }),
        json!({
            "name": "mashiro_search_prompts",
            "title": "检索提示词库",
            "description": "在用户本地的提示词库里按关键词检索，返回标题、正文、负向词与标签。可以直接拿命中结果的正文去生成，省去重新组织提示词。",
            "annotations": { "title": "检索提示词库", "readOnlyHint": true },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "keyword": { "type": "string", "description": "关键词，匹配标题、正文与标签；留空返回最近的条目" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 50, "default": 10 },
                    "favorite": { "type": "boolean", "description": "只看收藏的条目" }
                }
            }
        }),
        json!({
            "name": "mashiro_generation_history",
            "title": "查看生成历史",
            "description": "读取最近的生成记录（提示词、参数、结果文件路径、状态）。用于「把刚才那张再改一版」这类需要复用上一次结果的请求。",
            "annotations": { "title": "查看生成历史", "readOnlyHint": true },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "limit": { "type": "integer", "minimum": 1, "maximum": 50, "default": 10 },
                    "keyword": { "type": "string", "description": "按提示词或模型名过滤" }
                }
            }
        }),
    ]
}

/// 界面展示用的工具摘要。设置页据此列出「本服务提供了什么」，
/// **不要在界面上另抄一份工具清单**——两份清单一定会漂移。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolBrief {
    pub name: String,
    pub title: String,
    pub description: String,
}

pub fn briefs() -> Vec<ToolBrief> {
    definitions()
        .iter()
        .map(|tool| ToolBrief {
            name: tool
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            title: tool
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            description: tool
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
        })
        .collect()
}

/// 每个工具的等待上限。返回 `None` 表示工具名不存在。
pub fn timeout_of(name: &str) -> Option<Duration> {
    match name {
        "mashiro_generate_image" | "mashiro_edit_image" => Some(LONG_TIMEOUT),
        "mashiro_run_workflow" => Some(WORKFLOW_TIMEOUT),
        "mashiro_list_capabilities"
        | "mashiro_enhance_prompt"
        | "mashiro_search_prompts"
        | "mashiro_generation_history" => Some(QUICK_TIMEOUT),
        _ => None,
    }
}

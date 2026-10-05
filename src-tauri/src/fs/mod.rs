//! 本地文件域。
//!
//! 前端所有持久化都经 `src/platform/storage.ts` → 这里的命令，
//! 不允许前端绕过校验直接操作磁盘。
//!
//! - [`paths`]：数据目录定位 + 路径白名单（安全边界）
//! - [`commands`]：读写 / 删除 / 导出类命令

pub(crate) mod commands;
pub(crate) mod paths;

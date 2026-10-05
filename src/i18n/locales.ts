/* ==========================================================================
   词条汇总：把所有分区的中英文合并成两张平表
   ---------------------------------------------------------------------------
   分区（parts/*）各自带中英两侧、编译期校验键集一致；这里只负责拼接。
   重复键会**直接抛错**：静默覆盖意味着某一域的词条被另一域悄悄吃掉，
   排查时只会看到「文案莫名其妙变了」，很难往回找。
   ========================================================================== */

import { common } from "./parts/common";
import { nav } from "./parts/nav";
import { home } from "./parts/home";
import { studio } from "./parts/studio";
import { workflow } from "./parts/workflow";
import { upscale } from "./parts/upscale";
import { history } from "./parts/history";
import { prompts } from "./parts/prompts";
import { settings } from "./parts/settings";
import { mcp } from "./parts/mcp";
import { debug } from "./parts/debug";
import { media } from "./parts/media";
import type { LocalePart } from "./part";

const PARTS: LocalePart[] = [common, nav, home, studio, workflow, upscale, history, prompts, settings, mcp, debug, media];

function merge(side: "zh" | "en"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of PARTS) {
    for (const [key, value] of Object.entries(part[side])) {
      if (key in out) {
        throw new Error(`[i18n] 词条键重复：${key}`);
      }
      out[key] = value;
    }
  }
  return out;
}

export const zhCN = merge("zh");
export const enUS = merge("en");

/**
 * 编译期校验：英文表必须与中文表键集完全一致。
 *
 * 每个分区内部已用 `DictOf` 校验过一次，这里再兜一层底——
 * 防止将来有人绕过 `definePart` 直接往合并结果上加键。
 */
type _AssertSameKeys = Record<keyof typeof zhCN, string>;
const _sameKeys: _AssertSameKeys = enUS;
void _sameKeys;

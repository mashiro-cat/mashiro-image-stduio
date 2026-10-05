import type { DictOf } from "./types";

/**
 * 一个词条分区。
 *
 * 中文在前、英文在后并由 `DictOf` 反向约束：
 * **漏翻一个键会在 `vue-tsc` 阶段直接报错**（`npm run build` 跑 vue-tsc），
 * 而不是上线后让用户看到裸中文。
 *
 * 分区而不是一个大文件：词条量已经过千，按域切开才能并行维护、冲突面小。
 * 合并见 `../locales.ts`。
 */
export interface LocalePart {
  zh: Record<string, string>;
  en: Record<string, string>;
}

/**
 * 定义一个词条分区，并在编译期校验中英键集一致。
 *
 * ⚠️ `Z` 必须是泛型且带 `const` 修饰，**两个都不能省**——
 * 这个坑踩过一次：第一版写成 `zh: Record<string, string>`，
 * 结果 `typeof zh` 的字面量键被拓宽成 `string`，`DictOf<typeof zh>`
 * 退化成 `Record<string, string>`，于是 `en` 传空对象都能过编译，
 * 「漏翻即报错」的保护完全是摆设（实测 `tsc` 退出码 0）。
 *
 * - `<Z extends Record<string,string>>` 让 `Z` 保持传入对象的字面量键集；
 * - `const` 让值也收窄成字面量（虽然这里只用到键，但顺手约束住更好）。
 */
export function definePart<const Z extends Record<string, string>>(zh: Z, en: DictOf<Z>): LocalePart {
  return { zh, en };
}

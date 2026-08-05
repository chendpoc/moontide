import { resolveLocale, type UiLang } from "../locale.js";
import { statuslineEn } from "./en.js";
import { statuslineZh } from "./zh.js";
import type { StatuslineCopy } from "./types.js";

const REGISTRY = { en: statuslineEn, zh: statuslineZh } as const satisfies Record<UiLang, StatuslineCopy>;

export type { StatuslineCopy };

export function statuslineCopy(lang: UiLang = resolveLocale()): StatuslineCopy {
  return REGISTRY[lang];
}

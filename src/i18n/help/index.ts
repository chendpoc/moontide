import { resolveLocale, type UiLang } from "../locale.js";
import { helpEn } from "./en.js";
import { helpZh } from "./zh.js";
import type { HelpCategoryKey, HelpStrings } from "./types.js";

const REGISTRY = { en: helpEn, zh: helpZh } as const satisfies Record<UiLang, HelpStrings>;

export type { HelpCategoryKey, HelpStrings };

export function helpStrings(lang: UiLang = resolveLocale()): HelpStrings {
  return REGISTRY[lang];
}

export function localizeHelpSummary(syntax: string, fallback: string, lang: UiLang = resolveLocale()): string {
  return helpStrings(lang).summaries[syntax] ?? fallback;
}

export function categoryLabel(category: string, lang: UiLang = resolveLocale()): string {
  const key = category.toLowerCase() as HelpCategoryKey;
  return helpStrings(lang).categories[key] ?? category;
}

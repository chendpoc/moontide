import type { ContextAlert } from "../../context-inspect/types.js";
import {
  resolveLocale,
  resetLocaleOverride,
  setLocaleOverride,
  type UiLang,
} from "../locale.js";
import { contextCopyEn } from "./en.js";
import { contextCopyZh } from "./zh.js";

const REGISTRY = { en: contextCopyEn, zh: contextCopyZh } as const;

export type ContextLang = keyof typeof REGISTRY;

export type { ContextCopy } from "./types.js";

export function resolveContextLang(): ContextLang {
  return resolveLocale();
}

export function setContextLangOverride(value: ContextLang | null): void {
  setLocaleOverride(value);
}

export function resetContextLangOverride(): void {
  resetLocaleOverride();
}

export function contextCopy(lang: ContextLang = resolveContextLang()) {
  return REGISTRY[lang];
}

export function formatAlert(alert: ContextAlert, lang?: ContextLang): string {
  const copy = contextCopy(lang);
  return copy.alert(alert.code, `${alert.percentUsed.toFixed(1)}%`);
}

export function fmtNum(value: number, lang: UiLang = resolveContextLang()): string {
  return value.toLocaleString(lang === "zh" ? "zh-CN" : "en-US");
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

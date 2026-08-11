import { resolveContextLang } from "../context/index.js";
import { ACTIVITY_QUOTES_EN } from "./quotes.en.js";
import { ACTIVITY_QUOTES_ZH } from "./quotes.zh.js";

export function pickActivityQuote(): string {
  const quotes = resolveContextLang() === "zh" ? ACTIVITY_QUOTES_ZH : ACTIVITY_QUOTES_EN;
  return quotes[Math.floor(Math.random() * quotes.length)] ?? quotes[0]!;
}

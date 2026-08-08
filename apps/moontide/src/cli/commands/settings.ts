import { DATA_DIR } from "@moontide/shared/constants/storage.js";
import { persistLocale, describeLocale, type UiLang } from "../../i18n/locale.js";
import { renderStatusStackAsync, resetStatusStackRender } from "../statusline/render-stack.js";
import { reply } from "./io.js";
import type { ReplCommandResult } from "./types.js";

function parseLang(value: string): UiLang | null {
  const normalized = value.toLowerCase();
  if (normalized === "en" || normalized === "english") {
    return "en";
  }
  if (normalized === "zh" || normalized === "zh-cn" || normalized === "zh_cn" || normalized === "chinese") {
    return "zh";
  }
  return null;
}

function handleLangSubcommand(arg: string | undefined): ReplCommandResult | Promise<ReplCommandResult> {
  const trimmed = arg?.trim() ?? "";

  if (!trimmed || trimmed === "status") {
    const { lang, source } = describeLocale();
    reply(`language: ${lang} (${source})`);
    reply("usage: /settings lang en|zh · see /help");
    return "handled";
  }

  const lang = parseLang(trimmed);
  if (!lang) {
    reply("usage: /settings lang en|zh · see /help");
    return "handled";
  }

  persistLocale(lang);
  resetStatusStackRender();
  reply(`language: ${lang} (saved to ${DATA_DIR}/config.toml)`);
  return renderStatusStackAsync().then(() => "handled" as const);
}

export async function handleSettingsCommand(arg: string | undefined): Promise<ReplCommandResult> {
  const trimmed = arg?.trim() ?? "";

  if (!trimmed || trimmed === "status") {
    const { lang, source } = describeLocale();
    reply(`language: ${lang} (${source})`);
    reply("usage: /settings lang en|zh · see /help");
    return "handled";
  }

  if (trimmed === "lang" || trimmed.startsWith("lang ")) {
    const sub = trimmed === "lang" ? undefined : trimmed.slice(4);
    return handleLangSubcommand(sub);
  }

  reply("usage: /settings lang en|zh · see /help");
  return "handled";
}

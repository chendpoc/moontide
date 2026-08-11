import { localeDefault } from "@moontide/agent";
import { DATA_DIR } from "@moontide/shared/constants/storage.js";
import { APP_ENV, envVarName } from "@moontide/shared/constants/index.js";
import { loadUiLang, saveUiLang, type UiLang } from "../config/ui-settings.js";

export type { UiLang };

let sessionOverride: UiLang | null = null;

export function resolveLocale(): UiLang {
  if (sessionOverride !== null) {
    return sessionOverride;
  }
  return loadUiLang() ?? localeDefault();
}

export function setLocaleOverride(value: UiLang | null): void {
  sessionOverride = value;
}

export function resetLocaleOverride(): void {
  sessionOverride = null;
}

export function persistLocale(lang: UiLang, workdir?: string): void {
  saveUiLang(lang, workdir);
  sessionOverride = null;
}

export function describeLocale(workdir?: string): { lang: UiLang; source: string } {
  if (sessionOverride !== null) {
    return { lang: sessionOverride, source: "session override" };
  }
  const fromConfig = loadUiLang(workdir);
  if (fromConfig) {
    return { lang: fromConfig, source: `${DATA_DIR}/config.toml` };
  }
  const envRaw = process.env[envVarName(APP_ENV.LANG)];
  if (envRaw) {
    return { lang: localeDefault(), source: envVarName(APP_ENV.LANG) };
  }
  return { lang: "en", source: "default" };
}

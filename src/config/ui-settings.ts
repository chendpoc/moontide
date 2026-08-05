import { readWorkspaceConfig, writeWorkspaceConfig } from "./workspace-config.js";

export type UiLang = "en" | "zh";

export function loadUiLang(workdir?: string): UiLang | undefined {
  const root = readWorkspaceConfig(workdir);
  const ui = root.ui as Record<string, unknown> | undefined;
  const raw = ui?.lang;
  if (raw === "zh" || raw === "en") {
    return raw;
  }
  return undefined;
}

export function saveUiLang(lang: UiLang, workdir?: string): void {
  const root = readWorkspaceConfig(workdir);
  const ui = (root.ui as Record<string, unknown> | undefined) ?? {};
  ui.lang = lang;
  root.ui = ui;
  writeWorkspaceConfig(root, workdir);
}

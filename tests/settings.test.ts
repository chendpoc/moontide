import type { Interface } from "node:readline/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { handleReplCommand } from "../packages/agent-cli/src/cli/commands/repl.js";
import { getWorkdir, setWorkdir } from "../packages/agent/src/config.js";
import { loadUiLang } from "../packages/agent-cli/src/config/ui-settings.js";
import { resolveContextLang, resetContextLangOverride } from "../packages/agent-cli/src/i18n/context/index.js";
import { describeLocale, persistLocale, resetLocaleOverride } from "../packages/agent-cli/src/i18n/locale.js";
import { DATA_DIR } from "@moontide/shared/constants/storage.js";
import { APP_ENV, envVarName } from "@moontide/shared/constants/env.js";

const configSource = `${DATA_DIR}/config.toml`;
const langEnv = envVarName(APP_ENV.LANG);

const fakeCtx = {
  rl: {} as Interface,
  getAgentSession: () => null,
  resetConversation: () => {},
};

describe("settings / locale", () => {
  let tmpDir: string;
  let originalWorkdir: string;
  let originalLang: string | undefined;

  afterEach(() => {
    resetLocaleOverride();
    resetContextLangOverride();
    setWorkdir(originalWorkdir);
    delete process.env.MOONTIDE_LANG;
    if (originalLang !== undefined) {
      process.env.MOONTIDE_LANG = originalLang;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists language to config.toml and resolves from file", async () => {
    originalWorkdir = getWorkdir();
    originalLang = process.env.MOONTIDE_LANG;
    tmpDir = mkdtempSync(join(tmpdir(), "moontide-settings-"));
    setWorkdir(tmpDir);
    delete process.env.MOONTIDE_LANG;

    const result = await handleReplCommand("/settings lang zh", fakeCtx);
    expect(result).toBe("handled");
    expect(loadUiLang()).toBe("zh");
    expect(resolveContextLang()).toBe("zh");
    expect(describeLocale()).toEqual({ lang: "zh", source: configSource });
  });

  it("prefers config.toml over MOONTIDE_LANG", () => {
    originalWorkdir = getWorkdir();
    originalLang = process.env.MOONTIDE_LANG;
    tmpDir = mkdtempSync(join(tmpdir(), "moontide-settings-"));
    setWorkdir(tmpDir);
    process.env.MOONTIDE_LANG = "en";

    persistLocale("zh");

    expect(resolveContextLang()).toBe("zh");
    expect(describeLocale()).toEqual({ lang: "zh", source: configSource });
  });

  it("falls back to MOONTIDE_LANG when config is absent", () => {
    originalWorkdir = getWorkdir();
    originalLang = process.env.MOONTIDE_LANG;
    tmpDir = mkdtempSync(join(tmpdir(), "moontide-settings-"));
    setWorkdir(tmpDir);
    process.env.MOONTIDE_LANG = "zh";

    expect(resolveContextLang()).toBe("zh");
    expect(describeLocale()).toEqual({ lang: "zh", source: langEnv });
  });
});

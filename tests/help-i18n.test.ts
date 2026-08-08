import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { handleHelpCommand } from "../apps/moontide/src/cli/commands/help.js";
import { getWorkdir, setWorkdir } from "../apps/moontide/src/config.js";
import { persistLocale, resetLocaleOverride } from "../apps/moontide/src/i18n/locale.js";
import { replyLines } from "./helpers/reply-capture.js";

describe("help i18n", () => {
  let tmpDir: string;
  let originalWorkdir: string;

  afterEach(() => {
    resetLocaleOverride();
    setWorkdir(originalWorkdir);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("shows Chinese help after /settings lang zh", () => {
    originalWorkdir = getWorkdir();
    tmpDir = mkdtempSync(join(tmpdir(), "moontide-help-"));
    setWorkdir(tmpDir);
    persistLocale("zh");

    const lines = replyLines(() => handleHelpCommand());

    expect(lines.some((line) => line.includes("REPL 命令"))).toBe(true);
    expect(lines.some((line) => line.includes("/settings lang en|zh|status"))).toBe(true);
    expect(lines.some((line) => line.includes("UI 语言"))).toBe(true);
    expect(lines.some((line) => line.includes("语言: zh"))).toBe(true);
  });
});

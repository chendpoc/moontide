import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { collectTsFiles, repoPath, scanTsFiles, type SourceMatch } from "./helpers/source-scan.js";

const AGENT_IMPORT = /from\s+["'].*agent\//;
const ANTHROPIC_SDK_IMPORT = /from\s+["']@anthropic-ai\/sdk/;
const CONTEXT_COMPOSER_IMPORT = /from\s+["'].*context\/composer\//;

describe("architecture boundaries (structural invariants)", () => {
  it("session/ does not import agent/", () => {
    const offenders = scanTsFiles(repoPath("src/session"), AGENT_IMPORT);
    expect(offenders).toEqual([]);
  });

  it("session/ does not import context/composer/", () => {
    const offenders = scanTsFiles(repoPath("src/session"), CONTEXT_COMPOSER_IMPORT);
    expect(offenders).toEqual([]);
  });

  it("session/ does not emit Agent Events (derive lives in plugins/builtin/log-sync)", () => {
    const offenders = scanTsFiles(repoPath("src/session"), /from\s+["'].*log\/event-hub/);
    expect(offenders).toEqual([]);
  });

  it("agent/ does not import @anthropic-ai/sdk", () => {
    const offenders = scanTsFiles(repoPath("src/agent"), ANTHROPIC_SDK_IMPORT);
    expect(offenders).toEqual([]);
  });

  it("context/ does not import agent/", () => {
    const offenders = scanTsFiles(repoPath("src/context"), AGENT_IMPORT);
    expect(offenders).toEqual([]);
  });

  it("context/composer/ does not import agent/", () => {
    const offenders = scanTsFiles(repoPath("src/context/composer"), AGENT_IMPORT);
    expect(offenders).toEqual([]);
  });

  it("context/ does not import @anthropic-ai/sdk", () => {
    const offenders = scanTsFiles(repoPath("src/context"), ANTHROPIC_SDK_IMPORT);
    expect(offenders).toEqual([]);
  });

  it("log/setup.ts does not import plugins/host or agent hooks", () => {
    const setupPath = repoPath("src/log/setup.ts");
    const source = readFileSync(setupPath, "utf8");
    expect(source).not.toMatch(/from\s+["'].*plugins\/host/);
    expect(source).not.toMatch(/from\s+["'].*agent\/hooks/);
  });

  it("context-inspect/ does not import agent/pipeline/", () => {
    const pipelineImport = /from\s+["'].*agent\/pipeline/;
    const offenders = scanTsFiles(repoPath("src/context-inspect"), pipelineImport);
    expect(offenders).toEqual([]);
  });

  it("plugins/builtin/session-persistence does not import cli/", () => {
    const cliImport = /from\s+["'].*cli\//;
    const offenders = scanTsFiles(
      repoPath("src/plugins/builtin/session-persistence"),
      cliImport,
    );
    expect(offenders).toEqual([]);
  });

  it("plugins/builtin does not import plugins/host or plugins/sdk", () => {
    const hostImport = /from\s+["'].*plugins\/host/;
    const sdkImport = /from\s+["'].*plugins\/sdk/;
    const offenders = [
      ...scanTsFiles(repoPath("src/plugins/builtin"), hostImport),
      ...scanTsFiles(repoPath("src/plugins/builtin"), sdkImport),
    ];
    expect(offenders).toEqual([]);
  });

  it("tools/ does not import agent/", () => {
    const offenders = scanTsFiles(repoPath("src/tools"), AGENT_IMPORT);
    expect(offenders).toEqual([]);
  });

  it("keeps @anthropic-ai/sdk inside llm adapter and legacy client shim", () => {
    const allowed = /\/(adapters|client)\//;
    const offenders = scanTsFiles(repoPath("src/llm"), ANTHROPIC_SDK_IMPORT).filter(
      ({ file }) => !allowed.test(file),
    );
    expect(offenders).toEqual([]);
  });

  it("errors/ does not import agent/", () => {
    const offenders = scanTsFiles(repoPath("src/errors"), AGENT_IMPORT);
    expect(offenders).toEqual([]);
  });

  it("src/ does not throw bare Error", () => {
    const offenders = scanTsFiles(repoPath("src"), /throw new Error\(/);
    expect(offenders).toEqual([]);
  });

  it("src/ does not use instanceof Error message ternary", () => {
    const pattern = /instanceof Error \? .* : String\(/;
    const allowed = /src\/errors\/|src\/agent\/hooks\/dispatcher\.ts|templates\/bodies\//;
    const offenders = scanTsFiles(repoPath("src"), pattern).filter(
      ({ file }) => !allowed.test(file),
    );
    expect(offenders).toEqual([]);
  });

  it("failures.ts reports errors via reportError", () => {
    const source = readFileSync(repoPath("src/agent/hooks/failures.ts"), "utf8");
    expect(source).toContain("reportError");
    expect(source).not.toMatch(/writeStderrLine\([\s\S]*failed/);
  });

  it("tool impl files do not declare ToolSpec or defineTool(s) (§2.1)", () => {
    const specPattern = /\bToolSpec\b|defineTool\(|defineTools\(|defineOptionalTool\(/;
    const implFiles = [
      ...collectTsFiles(repoPath("src/tools/builtins")).filter(
        (file) => !file.endsWith(`${path.sep}tools.ts`),
      ),
      ...collectTsFiles(repoPath("src/plugins/builtin/code-repl")).filter(
        (file) => !file.endsWith(`${path.sep}tools.ts`),
      ),
      ...collectTsFiles(repoPath("src/plugins/builtin/deep-research")).filter(
        (file) => !file.endsWith(`${path.sep}tools.ts`),
      ),
    ];
    const offenders: SourceMatch[] = implFiles.flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .map((text, index) => ({ file, line: index + 1, text: text.trim() }))
        .filter(({ text }) => specPattern.test(text)),
    );
    expect(offenders).toEqual([]);
  });

  it("tool factories use plural defineXxxTools() shape (§2.1)", () => {
    const singularFactory = /export function define\w+Tool\(/;
    const dirs = [
      repoPath("src/tools/builtins"),
      repoPath("src/plugins/builtin/code-repl"),
      repoPath("src/plugins/builtin/deep-research"),
    ];
    const offenders = dirs.flatMap((dir) => scanTsFiles(dir, singularFactory));
    expect(offenders).toEqual([]);
  });

  it("register-defaults uses manifest factories only (no singleTool adapters)", () => {
    const source = readFileSync(repoPath("src/tools/register-defaults.ts"), "utf8");
    expect(source).not.toMatch(/\bsingleTool\b|\boptionalSingleTool\b/);
    expect(source).not.toMatch(/\bdefineInspectContextTool\b|\bdefineCodeReplTool\b|\bdefineDeepResearchTool\b/);
  });

  it("src/ does not hardcode legacy ocula identifiers", () => {
    const allowed = /src\/constants\/brand\.ts|templates\/bodies\//;
    const patterns = [/\bocula\b/i, /MOONTIDE_/, /\.ocula\b/];
    const offenders = patterns.flatMap((pattern) =>
      scanTsFiles(repoPath("src"), pattern).filter(({ file }) => !allowed.test(file)),
    );
    expect(offenders).toEqual([]);
  });

  it("src/ uses PRODUCT_NAME instead of hardcoded MoonTide (brand.ts only)", () => {
    const brandPath = repoPath("src/constants/brand.ts");
    const offenders = scanTsFiles(repoPath("src"), /["']MoonTide["']/).filter(
      ({ file }) => file !== brandPath,
    );
    expect(offenders).toEqual([]);
  });
});

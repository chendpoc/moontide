import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { collectTsFiles, repoPath, scanTsFiles, type SourceMatch } from "../helpers/source-scan.js";

const AGENT_IMPORT = /from\s+["'].*agent\//;
const ANTHROPIC_SDK_IMPORT = /from\s+["']@anthropic-ai\/sdk/;
const CONTEXT_COMPOSER_IMPORT = /from\s+["'].*context\/composer\//;

describe("architecture boundaries (structural invariants)", () => {
  it("§17: root has no src/ monolith directory", () => {
    expect(existsSync(repoPath("src"))).toBe(false);
  });

  it("session/ does not import agent/", () => {
    const offenders = scanTsFiles(repoPath("packages/session/src"), AGENT_IMPORT);
    expect(offenders).toEqual([]);
  });

  it("@moontide/session does not import context-composer", () => {
    const offenders = scanTsFiles(repoPath("packages/session/src"), /from\s+["']@moontide\/context-composer/);
    expect(offenders).toEqual([]);
  });

  it("src/ does not import monolith context/composer (use @moontide/context-composer)", () => {
    const legacyImport = /from\s+["'](?:\.\.?\/)+context\/composer\//;
    const offenders = scanTsFiles(repoPath("packages/agent-cli/src"), legacyImport);
    expect(offenders).toEqual([]);
  });

  it("@moontide/context-composer does not import agent/ or config", () => {
    const configImport = /from\s+["'][^"']*\/config\.js["']/;
    const offenders = [
      ...scanTsFiles(repoPath("packages/context-composer/src"), AGENT_IMPORT),
      ...scanTsFiles(repoPath("packages/context-composer/src"), configImport),
      ...scanTsFiles(repoPath("packages/context-composer/src"), /from\s+["'].*log\//),
      ...scanTsFiles(repoPath("packages/context-composer/src"), /from\s+["'].*context-inspect\//),
    ];
    expect(offenders).toEqual([]);
  });

  it("@moontide/session does not import config or @moontide/log", () => {
    const configImport = /from\s+["'].*config/;
    const logImport = /from\s+["']@moontide\/log/;
    const legacyLogImport = /from\s+["'].*log\//;
    const offenders = [
      ...scanTsFiles(repoPath("packages/session/src"), configImport),
      ...scanTsFiles(repoPath("packages/session/src"), logImport),
      ...scanTsFiles(repoPath("packages/session/src"), legacyLogImport),
    ];
    expect(offenders).toEqual([]);
  });

  it("@moontide/log does not import agent/ or config", () => {
    const configImport = /from\s+["'][^"']*\/config\.js["']/;
    const offenders = [
      ...scanTsFiles(repoPath("packages/log/src"), AGENT_IMPORT),
      ...scanTsFiles(repoPath("packages/log/src"), configImport),
      ...scanTsFiles(repoPath("packages/log/src"), /from\s+["'].*plugins\//),
    ];
    expect(offenders).toEqual([]);
  });

  it("src/ does not import monolith log core (use @moontide/log)", () => {
    const legacyCore =
      /from\s+["'](?:\.\.?\/)+log\/(event-hub|run|persist|enrich|types|outputs\/jsonl)/;
    const offenders = scanTsFiles(repoPath("packages/agent-cli/src"), legacyCore);
    expect(offenders).toEqual([]);
  });

  it("src/ does not import monolith session/ (use @moontide/session)", () => {
    const legacyImport = /from\s+["'](?:\.\.?\/)+session\//;
    const offenders = scanTsFiles(repoPath("packages/agent-cli/src"), legacyImport);
    expect(offenders).toEqual([]);
  });

  it("session/ does not emit Agent Events (derive via RunEvent in packages/agent-cli)", () => {
    const offenders = scanTsFiles(repoPath("packages/session/src"), /from\s+["'].*log\/(event-hub|index|run)/);
    expect(offenders).toEqual([]);
  });

  it("agent/ does not import @anthropic-ai/sdk", () => {
    const offenders = scanTsFiles(repoPath("packages/agent/src/agent"), ANTHROPIC_SDK_IMPORT);
    expect(offenders).toEqual([]);
  });

  it("context/ does not import agent/", () => {
    const contextDir = repoPath("packages/agent-cli/src/context");
    try {
      readdirSync(contextDir);
    } catch {
      return;
    }
    const offenders = scanTsFiles(contextDir, AGENT_IMPORT);
    expect(offenders).toEqual([]);
  });

  it("src/context/ does not import monolith context/composer (use @moontide/context-composer)", () => {
    const contextDir = repoPath("packages/agent-cli/src/context");
    try {
      readdirSync(contextDir);
    } catch {
      return;
    }
    const legacyImport = /from\s+["'](?:\.\.?\/)+context\/composer\//;
    const offenders = scanTsFiles(contextDir, legacyImport);
    expect(offenders).toEqual([]);
  });

  it("agent deep-mode compose paths do not import plugins/builtin/", () => {
    const pluginImport = /from\s+["'].*plugins\/builtin/;
    const files = [
      repoPath("packages/agent/src/agent/deep-mode.ts"),
      repoPath("packages/agent/src/agent/compose-for-turn.ts"),
      repoPath("packages/agent/src/agent/working-set-compose.ts"),
    ];
    const offenders = files.flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .map((text, index) => ({ file, line: index + 1, text: text.trim() }))
        .filter(({ text }) => pluginImport.test(text)),
    );
    expect(offenders).toEqual([]);
  });


  it("@moontide/llm does not import agent/ or @moontide/context-composer", () => {
    const composerImport = /from\s+["']@moontide\/context-composer/;
    const offenders = [
      ...scanTsFiles(repoPath("packages/llm/src"), AGENT_IMPORT),
      ...scanTsFiles(repoPath("packages/llm/src"), composerImport),
      ...scanTsFiles(repoPath("packages/llm/src"), CONTEXT_COMPOSER_IMPORT),
    ];
    expect(offenders).toEqual([]);
  });

  it("log/setup.ts does not import plugins/host or legacy hook stack", () => {
    const setupPath = repoPath("packages/agent-cli/src/log/setup.ts");
    const source = readFileSync(setupPath, "utf8");
    expect(source).not.toMatch(/from\s+["'].*plugins\/host/);
    expect(source).not.toMatch(/from\s+["'].*agent\/hooks/);
  });

  it("context-inspect/ does not import agent/pipeline/", () => {
    const pipelineImport = /from\s+["'].*agent\/pipeline/;
    const offenders = scanTsFiles(repoPath("packages/agent/src/context-inspect"), pipelineImport);
    expect(offenders).toEqual([]);
  });

  it("plugins/builtin/session-persistence does not import cli/", () => {
    const cliImport = /from\s+["'].*cli\//;
    const offenders = scanTsFiles(
      repoPath("packages/agent/src/plugins/builtin/session-persistence"),
      cliImport,
    );
    expect(offenders).toEqual([]);
  });

  it("@moontide/evals does not import packages/agent/src", () => {
    const deepImport = /from\s+["'].*packages\/agent\/src/;
    const offenders = scanTsFiles(repoPath("packages/evals"), deepImport);
    expect(offenders).toEqual([]);
  });

  it("@moontide/evals does not depend on @moontide/agent-cli", () => {
    const pkg = JSON.parse(
      readFileSync(repoPath("packages/evals/package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies?.["@moontide/agent-cli"]).toBeUndefined();
  });

  it("@moontide/evals does not import packages/agent-cli/src", () => {
    const deepImport = /from\s+["'].*packages\/agent-cli\/src/;
    const offenders = scanTsFiles(repoPath("packages/evals"), deepImport);
    expect(offenders).toEqual([]);
  });

  it("session-persistence does not call reply (Harness has no REPL I/O)", () => {
    const replyCall = /\breply\s*[(:]/;
    const offenders = scanTsFiles(
      repoPath("packages/agent/src/plugins/builtin/session-persistence"),
      replyCall,
    );
    expect(offenders).toEqual([]);
  });

  it("@moontide/agent does not export REPL command types from session-persistence", () => {
    const source = readFileSync(repoPath("packages/agent/src/index.ts"), "utf8");
    expect(source).not.toMatch(/\bParsedReplParts\b|\bReplCommandResult\b|\bSessionPersistenceDeps\b/);
    expect(source).not.toMatch(/\bhandleSaveCommand\b|\bhandleResumeSessionCommand\b/);
  });

  it("@moontide/agent does not write process.stderr directly", () => {
    const offenders = scanTsFiles(repoPath("packages/agent/src"), /process\.stderr\.write/);
    expect(offenders).toEqual([]);
  });

  it("@moontide/agent has no legacy HookDispatcher stack (M7)", () => {
    const patterns = [
      /\bHookDispatcher\b/,
      /\bHookPhase\b/,
      /\bhooks\.dispatch\b/,
      /legacy-hook-bridge/,
      /agent\/hooks\//,
    ];
    const offenders = patterns.flatMap((pattern) =>
      scanTsFiles(repoPath("packages/agent/src"), pattern),
    );
    expect(offenders).toEqual([]);
  });

  it("sidecar-host uses sidecarObservers port (not sidecarHooks)", () => {
    const source = readFileSync(repoPath("packages/sidecar-host/src/ports/runtime.ts"), "utf8");
    expect(source).toContain("sidecarObservers");
    expect(source).not.toMatch(/\bsidecarHooks\s*\(/);
  });

  it("plugins/builtin does not import sidecar-host or plugins-sdk", () => {
    const hostImport = /from\s+["']@moontide\/sidecar-host/;
    const sdkImport = /from\s+["']@moontide\/plugins-sdk/;
    const legacyHostImport = /from\s+["'].*plugins\/host/;
    const legacySdkImport = /from\s+["'].*plugins\/sdk/;
    const offenders = [
      ...scanTsFiles(repoPath("packages/agent/src/plugins/builtin"), hostImport),
      ...scanTsFiles(repoPath("packages/agent/src/plugins/builtin"), sdkImport),
      ...scanTsFiles(repoPath("packages/agent/src/plugins/builtin"), legacyHostImport),
      ...scanTsFiles(repoPath("packages/agent/src/plugins/builtin"), legacySdkImport),
    ];
    expect(offenders).toEqual([]);
  });

  it("@moontide/plugins-sdk does not import agent/", () => {
    const offenders = scanTsFiles(repoPath("packages/plugins-sdk/src"), AGENT_IMPORT);
    expect(offenders).toEqual([]);
  });

  it("@moontide/sidecar-host does not import agent/", () => {
    const offenders = scanTsFiles(repoPath("packages/sidecar-host/src"), AGENT_IMPORT);
    expect(offenders).toEqual([]);
  });

  it("tools/ does not import agent/", () => {
    const offenders = scanTsFiles(repoPath("packages/agent/src/tools"), AGENT_IMPORT);
    expect(offenders).toEqual([]);
  });

  it("@moontide/agent does not import CLI terminal, log/format, or errors/report", () => {
    const terminalImport = /from\s+["'].*terminal\//;
    const formatImport = /from\s+["'].*log\/format\//;
    const reportImport = /from\s+["'].*errors\/report/;
    const offenders = [
      ...scanTsFiles(repoPath("packages/agent/src"), terminalImport),
      ...scanTsFiles(repoPath("packages/agent/src"), formatImport),
      ...scanTsFiles(repoPath("packages/agent/src"), reportImport),
    ];
    expect(offenders).toEqual([]);
  });

  it("agent-cli does not import @moontide/agent-core", () => {
    const offenders = scanTsFiles(
      repoPath("packages/agent-cli/src"),
      /from\s+["']@moontide\/agent-core/,
    );
    expect(offenders).toEqual([]);
  });

  it("@moontide/tools does not import agent/ or config", () => {
    const productConfigImport = /from\s+["'](?:\.\.\/)+config\.js["']/;
    const offenders = [
      ...scanTsFiles(repoPath("packages/tools/src"), AGENT_IMPORT),
      ...scanTsFiles(repoPath("packages/tools/src"), productConfigImport),
      ...scanTsFiles(repoPath("packages/tools/src"), /from\s+["'].*context-inspect/),
    ];
    expect(offenders).toEqual([]);
  });

  it("src/ does not import monolith tools builtins (use @moontide/tools)", () => {
    const legacyImport = /from\s+["'](?:\.\.?\/)+tools\/(builtins|define-tool|registry)/;
    const offenders = scanTsFiles(repoPath("packages/agent-cli/src"), legacyImport);
    expect(offenders).toEqual([]);
  });

  it("session/ does not import @anthropic-ai/sdk", () => {
    const offenders = scanTsFiles(repoPath("packages/session/src"), ANTHROPIC_SDK_IMPORT);
    expect(offenders).toEqual([]);
  });

  it("llm/ does not import @anthropic-ai/sdk", () => {
    const offenders = scanTsFiles(repoPath("packages/llm/src"), ANTHROPIC_SDK_IMPORT);
    expect(offenders).toEqual([]);
  });

  it("packages/llm does not throw bare Error", () => {
    const offenders = scanTsFiles(repoPath("packages/llm/src"), /throw new Error\(/);
    expect(offenders).toEqual([]);
  });

  it("src/ does not import monolith llm/ (use @moontide/llm)", () => {
    const legacyImport = /from\s+["'](?:\.\.?\/)+llm\//;
    const offenders = scanTsFiles(repoPath("packages/agent-cli/src"), legacyImport);
    expect(offenders).toEqual([]);
  });

  it("context/ does not import @anthropic-ai/sdk", () => {
    const offenders = scanTsFiles(repoPath("packages/agent-cli/src/context"), ANTHROPIC_SDK_IMPORT);
    expect(offenders).toEqual([]);
  });

  it("errors/ does not import agent/", () => {
    const offenders = scanTsFiles(repoPath("packages/agent-cli/src/errors"), AGENT_IMPORT);
    expect(offenders).toEqual([]);
  });

  it("src/ does not throw bare Error", () => {
    const offenders = scanTsFiles(repoPath("packages/agent-cli/src"), /throw new Error\(/);
    expect(offenders).toEqual([]);
  });

  it("src/ does not use instanceof Error message ternary", () => {
    const pattern = /instanceof Error \? .* : String\(/;
    const allowed = /packages\/agent-cli\/src\/errors\/|packages\/agent\/src\/agent\/run-observers\/dispatcher\.ts|templates\/bodies\//;
    const offenders = scanTsFiles(repoPath("packages/agent-cli/src"), pattern).filter(
      ({ file }) => !allowed.test(file),
    );
    expect(offenders).toEqual([]);
  });

  it("failures.ts publishes errors via AgentEventPipeline", () => {
    const source = readFileSync(repoPath("packages/agent/src/agent/run-observers/failures.ts"), "utf8");
    expect(source).toContain("publishAgentError");
    expect(source).not.toContain("errors/report");
    expect(source).not.toMatch(/writeStderrLine\([\s\S]*failed/);
  });

  it("tool impl files do not declare ToolSpec or defineTool(s) (§2.1)", () => {
    const specPattern = /\bToolSpec\b|defineTool\(|defineTools\(|defineOptionalTool\(/;
    const implFiles = [
      ...collectTsFiles(repoPath("packages/tools/src/builtins")).filter(
        (file) => !file.endsWith(`${path.sep}tools.ts`),
      ),
      ...collectTsFiles(repoPath("packages/tools/src/extensions/code-repl")).filter(
        (file) => !file.endsWith(`${path.sep}tools.ts`),
      ),
      ...collectTsFiles(repoPath("packages/tools/src/extensions/deep-research")).filter(
        (file) => !file.endsWith(`${path.sep}tools.ts`),
      ),
      ...collectTsFiles(repoPath("packages/tools/src/extensions/work-mem")).filter(
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
      repoPath("packages/tools/src/builtins"),
      repoPath("packages/tools/src/extensions/code-repl"),
      repoPath("packages/tools/src/extensions/deep-research"),
      repoPath("packages/tools/src/extensions/work-mem"),
    ];
    const offenders = dirs.flatMap((dir) => scanTsFiles(dir, singularFactory));
    expect(offenders).toEqual([]);
  });

  it("register-defaults uses manifest factories only (no singleTool adapters)", () => {
    const source = readFileSync(repoPath("packages/agent/src/tools/register-defaults.ts"), "utf8");
    expect(source).not.toMatch(/\bsingleTool\b|\boptionalSingleTool\b/);
    expect(source).not.toMatch(/\bdefineInspectContextTool\b|\bdefineCodeReplTool\b|\bdefineDeepResearchTool\b/);
  });

  it("src/ does not hardcode legacy ocula identifiers", () => {
    const allowed = /packages\/shared\/src\/constants\/brand\.ts|templates\/bodies\//;
    const patterns = [/\bocula\b/i, /MOONTIDE_/, /\.ocula\b/];
    const offenders = patterns.flatMap((pattern) =>
      scanTsFiles(repoPath("packages/agent-cli/src"), pattern).filter(({ file }) => !allowed.test(file)),
    );
    expect(offenders).toEqual([]);
  });

  it("src/ uses PRODUCT_NAME instead of hardcoded MoonTide (brand.ts only)", () => {
    const brandPath = repoPath("packages/shared/src/constants/brand.ts");
    const offenders = scanTsFiles(repoPath("packages/agent-cli/src"), /["']MoonTide["']/).filter(
      ({ file }) => file !== brandPath,
    );
    expect(offenders).toEqual([]);
  });

  it("@moontide/shared does not import config", () => {
    const configImport = /from\s+["'].*config/;
    const offenders = scanTsFiles(repoPath("packages/shared/src"), configImport);
    expect(offenders).toEqual([]);
  });

  it("src/ does not import monolith utils/constants/storage (use @moontide/shared)", () => {
    const legacyImport =
      /from\s+["'](?:\.\.?\/)+(?:utils|constants|storage)\//;
    const offenders = scanTsFiles(repoPath("packages/agent-cli/src"), legacyImport);
    expect(offenders).toEqual([]);
  });

  it("src/ and tests/ do not reference legacy emitDraft identifier", () => {
    const pattern = /\bemitDraft\b/;
    const excluded = repoPath("tests/conformance/architecture-boundaries.test.ts");
    const offenders = [
      ...scanTsFiles(repoPath("packages/agent-cli/src"), pattern),
      ...scanTsFiles(repoPath("tests"), pattern),
    ].filter(({ file }) => file !== excluded);
    expect(offenders).toEqual([]);
  });

  it("src/ outside log/ does not import log/event-hub or log/run", () => {
    const logDir = `${repoPath("packages/agent-cli/src/log")}${path.sep}`;
    const importPattern = /from\s+["'][^"']*log\/(event-hub|run)/;
    const offenders = collectTsFiles(repoPath("packages/agent-cli/src"))
      .filter((file) => !file.startsWith(logDir))
      .flatMap((file) =>
        readFileSync(file, "utf8")
          .split("\n")
          .map((text, index) => ({ file, line: index + 1, text: text.trim() }))
          .filter(({ text }) => importPattern.test(text) && !text.startsWith("import type")),
      );
    expect(offenders).toEqual([]);
  });

  it("src/ does not export _-prefixed functions (module-internal convention)", () => {
    const exportPattern = /export\s+(async\s+)?function\s+_/;
    const offenders = scanTsFiles(repoPath("packages/agent-cli/src"), exportPattern);
    expect(offenders).toEqual([]);
  });
});

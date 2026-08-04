import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { repoPath, scanTsFiles } from "./helpers/source-scan.js";

const AGENT_IMPORT = /from\s+["'].*agent\//;
const ANTHROPIC_SDK_IMPORT = /from\s+["']@anthropic-ai\/sdk/;

describe("architecture boundaries (structural invariants)", () => {
  it("session/ does not import agent/", () => {
    const offenders = scanTsFiles(repoPath("src/session"), AGENT_IMPORT);
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

  it("context/ does not import @anthropic-ai/sdk", () => {
    const offenders = scanTsFiles(repoPath("src/context"), ANTHROPIC_SDK_IMPORT);
    expect(offenders).toEqual([]);
  });

  it("log/setup.ts does not import plugin-host or agent hooks", () => {
    const setupPath = repoPath("src/log/setup.ts");
    const source = readFileSync(setupPath, "utf8");
    expect(source).not.toMatch(/from\s+["'].*plugin-host/);
    expect(source).not.toMatch(/from\s+["'].*agent\/hooks/);
  });

  it("keeps @anthropic-ai/sdk inside llm adapter and legacy client shim", () => {
    const allowed = /\/(adapters|client)\//;
    const offenders = scanTsFiles(repoPath("src/llm"), ANTHROPIC_SDK_IMPORT).filter(
      ({ file }) => !allowed.test(file),
    );
    expect(offenders).toEqual([]);
  });
});

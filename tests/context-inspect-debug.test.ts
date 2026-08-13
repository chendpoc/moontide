import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getWorkdir, setWorkdir } from "../packages/agent/src/config.js";
import { emitDebugRecord } from "../packages/agent/src/context-inspect/debug-emit.js";
import { debugLogPath } from "../packages/agent/src/context-inspect/debug-file.js";
import {
  getDebugLevel,
  isDebugFileEnabled,
  parseDebugLevelArg,
  resetDebugOverride,
  setDebugOverride,
} from "../packages/agent/src/context-inspect/debug-mode.js";
import { formatDebugRecord } from "../packages/agent/src/context-inspect/debug-format.js";
import {
  handleDebugCompose,
  handleDebugLlmCall,
  handleDebugToolUse,
} from "../packages/agent/src/plugins/builtin/context/debug-hook-module.js";
import { createTestEventOutputs } from "@moontide/agent/testing";
import { resetRun } from "../packages/agent-cli/src/log/index.js";
import { clearTestRuntime, installTestRuntime } from "./helpers/test-runtime.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";

const DEBUG_ENV = "MOONTIDE_DEBUG";

describe("context-inspect debug mode", () => {
  beforeEach(() => {
    delete process.env[DEBUG_ENV];
    delete process.env.MOONTIDE_ENV;
    resetDebugOverride();
  });

  afterEach(() => {
    delete process.env[DEBUG_ENV];
    delete process.env.MOONTIDE_ENV;
    resetDebugOverride();
  });

  it("parseDebugLevelArg maps on and terminal to file", () => {
    expect(parseDebugLevelArg("on")).toBe("file");
    expect(parseDebugLevelArg("terminal")).toBe("file");
    expect(parseDebugLevelArg("file")).toBe("file");
    expect(parseDebugLevelArg("off")).toBe("off");
  });

  it("file tier enables debug jsonl only", () => {
    setDebugOverride("file");
    expect(getDebugLevel()).toBe("file");
    expect(isDebugFileEnabled()).toBe(true);
  });

  it("formatDebugRecord includes full JSON body", () => {
    const text = formatDebugRecord({
      kind: "compose",
      turn: 1,
      request: { system: "sys", messages: [], tools: [] },
    });
    expect(text).toContain('"kind": "compose"');
    expect(text).toContain('"system": "sys"');
  });
});

describe("context-inspect debug hooks", () => {
  let tmpDir = "";
  let debugTerminal: string[] = [];
  let originalWorkdir = "";

  beforeEach(() => {
    originalWorkdir = getWorkdir();
    tmpDir = createTmpWorkdir("moontide-debug-");
    setWorkdir(tmpDir);
    debugTerminal = [];
    resetDebugOverride();
    resetRun("debug-run-1");
    installTestRuntime(tmpDir, createTestEventOutputs({ debugTerminal }));
  });

  afterEach(() => {
    clearTestRuntime();
    resetDebugOverride();
    setWorkdir(originalWorkdir);
    removeTmpWorkdir(tmpDir);
  });

  it("writes full compose to debug jsonl when file tier is on", () => {
    setDebugOverride("file");
    handleDebugCompose({
      composed: {
        request: { system: "hello", messages: [{ role: "user", content: "hi" }], tools: [] },
        manifest: { turn: 1, toolDefinitionNames: [] },
      },
    });

    expect(debugTerminal).toEqual([]);
    expect(fs.existsSync(debugLogPath(tmpDir))).toBe(true);
    const line = fs.readFileSync(debugLogPath(tmpDir), "utf8").trim();
    expect(JSON.parse(line).kind).toBe("compose");
  });

  it("writes full llm and tool records to debug jsonl in file tier", () => {
    setDebugOverride("file");

    handleDebugLlmCall({
      turn: 2,
      request: { model: "m", messages: [], tools: [], maxTokens: 1 },
      outcome: { status: "succeeded", response: { content: [{ type: "text", text: "ok" }], stopReason: "end_turn" } },
    });

    handleDebugToolUse({
      turn: 2,
      toolName: "read_file",
      toolUseId: "tu-1",
      toolInput: { path: "a.ts" },
      outcome: { status: "succeeded", output: "file body here" },
    });

    const path = debugLogPath(tmpDir);
    expect(fs.existsSync(path)).toBe(true);
    const lines = fs.readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);

    const llm = JSON.parse(lines[0]!) as { kind: string; outcome: { status: string } };
    expect(llm.kind).toBe("llm_call");
    expect(llm.outcome.status).toBe("succeeded");

    const tool = JSON.parse(lines[1]!) as { kind: string; outcome: { output: string } };
    expect(tool.kind).toBe("tool_use");
    expect(tool.outcome.output).toBe("file body here");

    expect(debugTerminal).toEqual([]);
  });

  it("emitDebugRecord is a no-op when debug is off", () => {
    setDebugOverride("off");
    emitDebugRecord({ kind: "compose", turn: 1, request: {} }, tmpDir);
    expect(debugTerminal).toEqual([]);
    expect(fs.existsSync(debugLogPath(tmpDir))).toBe(false);
  });

  it("failed tool_use debug record includes errorCode", () => {
    setDebugOverride("file");

    handleDebugToolUse({
      turn: 3,
      toolName: "http_fetch",
      toolUseId: "tu-fail",
      toolInput: { url: "https://example.test" },
      outcome: { status: "failed", error: "timeout" },
    });

    const path = debugLogPath(tmpDir);
    const line = fs.readFileSync(path, "utf8").trim();
    const record = JSON.parse(line) as { kind: string; errorCode: string; outcome: { status: string } };
    expect(record.kind).toBe("tool_use");
    expect(record.errorCode).toBe("tool");
    expect(record.outcome.status).toBe("failed");
  });

  it("denied tool_use debug record includes permission errorCode", () => {
    setDebugOverride("file");

    handleDebugToolUse({
      turn: 4,
      toolName: "bash",
      toolUseId: "tu-deny",
      toolInput: { command: "rm -rf /" },
      outcome: { status: "denied", reason: "blocked" },
    });

    const path = debugLogPath(tmpDir);
    const line = fs.readFileSync(path, "utf8").trim();
    const record = JSON.parse(line) as { errorCode: string };
    expect(record.errorCode).toBe("permission");
  });
});

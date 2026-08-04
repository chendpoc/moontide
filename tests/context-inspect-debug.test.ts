import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getWorkdir, setWorkdir } from "../src/config.js";
import { emitDebugRecord } from "../src/context-inspect/debug-emit.js";
import { debugLogPath } from "../src/context-inspect/debug-file.js";
import {
  getDebugLevel,
  isDebugFileEnabled,
  isDebugTerminalEnabled,
  parseDebugLevelArg,
  resetDebugOverride,
  setDebugOverride,
} from "../src/context-inspect/debug-mode.js";
import { formatDebugRecord } from "../src/context-inspect/debug-format.js";
import {
  handleDebugCompose,
  handleDebugLlmCall,
  handleDebugToolUse,
} from "../src/plugins/builtin/context/debug-hook-module.js";
import { resetRun } from "../src/log/run.js";
import { setStderrWriterForTest } from "../src/terminal/write.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";

const DEBUG_ENV = "OCULA_DEBUG";

describe("context-inspect debug mode", () => {
  beforeEach(() => {
    delete process.env[DEBUG_ENV];
    resetDebugOverride();
  });

  afterEach(() => {
    delete process.env[DEBUG_ENV];
    resetDebugOverride();
  });

  it("parseDebugLevelArg maps on to terminal", () => {
    expect(parseDebugLevelArg("on")).toBe("terminal");
    expect(parseDebugLevelArg("terminal")).toBe("terminal");
    expect(parseDebugLevelArg("file")).toBe("file");
    expect(parseDebugLevelArg("off")).toBe("off");
  });

  it("tiers terminal and file correctly", () => {
    setDebugOverride("terminal");
    expect(getDebugLevel()).toBe("terminal");
    expect(isDebugTerminalEnabled()).toBe(true);
    expect(isDebugFileEnabled()).toBe(false);

    setDebugOverride("file");
    expect(isDebugTerminalEnabled()).toBe(true);
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
  let stderr = "";
  let originalWorkdir = "";

  beforeEach(() => {
    originalWorkdir = getWorkdir();
    tmpDir = createTmpWorkdir("ocula-debug-");
    setWorkdir(tmpDir);
    stderr = "";
    resetDebugOverride();
    resetRun("debug-run-1");
    setStderrWriterForTest((chunk) => {
      stderr += chunk;
      return true;
    });
  });

  afterEach(() => {
    setStderrWriterForTest(null);
    resetDebugOverride();
    setWorkdir(originalWorkdir);
    removeTmpWorkdir(tmpDir);
  });

  it("writes full compose to stderr in terminal tier", () => {
    setDebugOverride("terminal");
    handleDebugCompose({
      composed: {
        request: { system: "hello", messages: [{ role: "user", content: "hi" }], tools: [] },
        manifest: { turn: 1, toolDefinitionNames: [] },
      },
    });

    expect(stderr).toContain("DEBUG turn 01");
    expect(stderr).toContain('"kind": "compose"');
    expect(stderr).toContain('"system": "hello"');
    expect(fs.existsSync(debugLogPath(tmpDir))).toBe(false);
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

    expect(stderr).toContain("llm_call");
    expect(stderr).toContain("tool_use");
  });

  it("emitDebugRecord is a no-op when debug is off", () => {
    setDebugOverride("off");
    emitDebugRecord({ kind: "compose", turn: 1, request: {} }, tmpDir);
    expect(stderr).toBe("");
    expect(fs.existsSync(debugLogPath(tmpDir))).toBe(false);
  });
});

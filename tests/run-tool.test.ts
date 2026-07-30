import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LoopContext } from "../src/agent/deps.js";
import * as permission from "../src/agent/pipeline/permission/index.js";
import { resetPlugins, setPlugins } from "../src/agent/pipeline/registry.js";
import { resolveToolUseOutcome, runToolUse } from "../src/agent/pipeline/runTool.js";
import { setWorkdir } from "../src/config.js";

let tmpDir = "";

const denyAllInteraction: LoopContext["userInteraction"] = {
  approveTool: async () => false,
  askQuestion: async () => {
    throw new Error("User question prompt is not configured");
  },
};

const loopCtx = (interaction = denyAllInteraction): LoopContext => ({
  userInteraction: interaction,
  isCompactAutoEnabled: () => false,
});

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oculeau-run-tool-"));
  setWorkdir(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  resetPlugins();
});

describe("resolveToolUseOutcome", () => {
  it("calls checkPermission exactly once for allow-class tools", async () => {
    fs.writeFileSync(path.join(tmpDir, "exists.txt"), "hello");
    const spy = vi.spyOn(permission, "checkPermission");
    const outcome = await resolveToolUseOutcome(
      {
        turn: 1,
        toolName: "read_file",
        toolInput: { path: "exists.txt" },
        toolUseId: "toolu_allow",
      },
      loopCtx(),
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("read_file", { path: "exists.txt" });
    expect(outcome).toEqual({ status: "succeeded", output: "hello" });
  });

  it("returns denied without executing the tool", async () => {
    const spy = vi.spyOn(permission, "checkPermission");
    const outcome = await resolveToolUseOutcome(
      {
        turn: 1,
        toolName: "bash",
        toolInput: { command: "sudo rm -rf /" },
        toolUseId: "toolu_deny",
      },
      loopCtx(),
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({
      status: "denied",
      reason: "Permission denied: bash",
    });
  });

  it("returns rejected when ask-class permission is not approved", async () => {
    const spy = vi.spyOn(permission, "checkPermission");
    const outcome = await resolveToolUseOutcome(
      {
        turn: 1,
        toolName: "bash",
        toolInput: { command: "rm foo.txt" },
        toolUseId: "toolu_reject",
      },
      loopCtx(),
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({
      status: "rejected",
      reason: "Permission denied by user: bash",
    });
  });

  it("succeeds when ask-class permission is approved", async () => {
    const spy = vi.spyOn(permission, "checkPermission");
    const outcome = await resolveToolUseOutcome(
      {
        turn: 1,
        toolName: "bash",
        toolInput: { command: "git status" },
        toolUseId: "toolu_ask",
      },
      loopCtx({
        ...denyAllInteraction,
        approveTool: async () => true,
      }),
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe("succeeded");
    if (outcome.status === "succeeded") {
      expect(outcome.output.length).toBeGreaterThan(0);
    }
  });

  it("returns failed for unknown tools", async () => {
    const outcome = await resolveToolUseOutcome(
      {
        turn: 1,
        toolName: "not_a_real_tool",
        toolInput: {},
        toolUseId: "toolu_unknown",
      },
      loopCtx(),
    );

    expect(outcome).toEqual({
      status: "failed",
      error: "Unknown tool: not_a_real_tool",
    });
  });

  it("returns failed when a handler reports Error-prefixed output", async () => {
    const outcome = await resolveToolUseOutcome(
      {
        turn: 1,
        toolName: "read_file",
        toolInput: { path: "missing.txt" },
        toolUseId: "toolu_missing",
      },
      loopCtx(),
    );

    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") {
      expect(outcome.error).toMatch(/ENOENT/);
    }
  });
});

describe("runToolUse", () => {
  it("passes a frozen hook record that plugins cannot mutate", async () => {
    setPlugins([
      {
        name: "reader",
        onToolUse(record) {
          expect(Object.isFrozen(record)).toBe(true);
          expect(Object.isFrozen(record.outcome)).toBe(true);
          return [];
        },
      },
    ]);

    fs.writeFileSync(path.join(tmpDir, "snapshot.txt"), "original content");

    const result = await runToolUse(
      {
        type: "tool_use",
        id: "toolu_snapshot",
        name: "read_file",
        input: { path: "snapshot.txt" },
      },
      1,
      loopCtx(),
    );

    expect(result.content).toBe("original content");
  });

  it("appends plugin modelAppend after the core tool result", async () => {
    setPlugins([
      {
        name: "observer",
        onToolUse() {
          return { modelAppend: "Note: truncated to 200 lines." };
        },
      },
      {
        name: "second",
        onToolUse() {
          return { modelAppend: "Audit: read allowed." };
        },
      },
    ]);

    fs.writeFileSync(path.join(tmpDir, "note.txt"), "line one");

    const result = await runToolUse(
      {
        type: "tool_use",
        id: "toolu_append",
        name: "read_file",
        input: { path: "note.txt" },
      },
      1,
      loopCtx(),
    );

    expect(result.content).toBe(
      "line one\n\nNote: truncated to 200 lines.\n\nAudit: read allowed.",
    );
  });
});

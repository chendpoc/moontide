import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LoopContext } from "../src/agent/deps.js";
import * as permission from "../src/agent/pipeline/permission/index.js";
import { resolveToolUseOutcome, runToolUse } from "../src/agent/pipeline/runTool.js";
import { setWorkdir } from "../src/config.js";
import { Session } from "../src/session/session.js";
import { setAlwaysAllowOverride, resetAlwaysAllowOverride } from "../src/tools/always-allow-mode.js";
import { joinPath } from "../src/utils/path.js";
import { clearTestRuntime, installTestRuntime } from "./helpers/test-runtime.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";

let tmpDir = "";
let testSession: Session;
let testRuntime: ReturnType<typeof installTestRuntime>;

const denyAllInteraction: LoopContext["userInteraction"] = {
  approveTool: async () => false,
  askQuestion: async () => {
    throw new Error("User question prompt is not configured");
  },
};

const loopCtx = (interaction = denyAllInteraction): LoopContext => ({
  userInteraction: interaction,
  session: testSession,
  runtime: testRuntime,
});

beforeEach(() => {
  delete process.env.MOONTIDE_ALWAYS_ALLOW;
  resetAlwaysAllowOverride();
  tmpDir = createTmpWorkdir("moontide-run-tool-");
  setWorkdir(tmpDir);
  testRuntime = installTestRuntime(tmpDir);
  testSession = Session.create(tmpDir);
});

afterEach(() => {
  removeTmpWorkdir(tmpDir);
  vi.restoreAllMocks();
  resetAlwaysAllowOverride();
  clearTestRuntime();
});

describe("resolveToolUseOutcome", () => {
  it("calls checkPermission exactly once for allow-class tools", async () => {
    fs.writeFileSync(joinPath(tmpDir, "exists.txt"), "hello");
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
    expect(spy).toHaveBeenCalledWith("read_file", { path: "exists.txt" }, testRuntime);
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

  it("auto-approves ask-class tools when always-allow is enabled", async () => {
    setAlwaysAllowOverride(true);
    const approve = vi.fn(async () => false);
    const outcome = await resolveToolUseOutcome(
      {
        turn: 1,
        toolName: "bash",
        toolInput: { command: "rm foo.txt" },
        toolUseId: "toolu_always",
      },
      loopCtx({ ...denyAllInteraction, approveTool: approve }),
    );

    expect(approve).not.toHaveBeenCalled();
    expect(outcome.status).toBe("succeeded");
  });

  it("still denies when always-allow is enabled but tool is deny-class", async () => {
    setAlwaysAllowOverride(true);
    const outcome = await resolveToolUseOutcome(
      {
        turn: 1,
        toolName: "bash",
        toolInput: { command: "sudo rm -rf /" },
        toolUseId: "toolu_deny_always",
      },
      loopCtx(),
    );

    expect(outcome).toEqual({
      status: "denied",
      reason: "Permission denied: bash",
    });
  });

  it("returns denied for unknown tools", async () => {
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
      status: "denied",
      reason: "Permission denied: not_a_real_tool",
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
  it("blocks execution when beforeToolUse decides to block", async () => {
    testRuntime.hookRegistry.sidecar().on("beforeToolUse", "guard", () => ({
      block: true,
      reason: "blocked by sidecar hook",
    }));

    fs.writeFileSync(joinPath(tmpDir, "secret.txt"), "secret");

    const result = await runToolUse(
      {
        type: "tool_use",
        id: "toolu_block",
        name: "read_file",
        input: { path: "secret.txt" },
      },
      1,
      loopCtx(),
    );

    expect(result.content).toContain("blocked by sidecar hook");
  });

  it("passes a frozen hook record that handlers cannot mutate", async () => {
    testRuntime.hookRegistry.sidecar().on("toolUse", "reader", (record) => {
      expect(Object.isFrozen(record)).toBe(true);
      expect(Object.isFrozen(record.outcome)).toBe(true);
    });

    fs.writeFileSync(joinPath(tmpDir, "snapshot.txt"), "original content");

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

  it("appends hook modelAppend after the core tool result", async () => {
    testRuntime.hookRegistry.sidecar().on("toolUse", "observer", () => ({
      modelAppend: "Note: truncated to 200 lines.",
    }));
    testRuntime.hookRegistry.sidecar().on("toolUse", "second", () => ({
      modelAppend: "Audit: read allowed.",
    }));

    fs.writeFileSync(joinPath(tmpDir, "note.txt"), "line one");

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

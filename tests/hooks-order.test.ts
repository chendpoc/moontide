import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { enableTestCollector, disableTestCollector, getCollectedEvents, resetRun } from "../apps/moontide/src/log/index.js";
import type { LLMCallRecord, ToolUseRecord } from "../apps/moontide/src/agent/pipeline/types.js";
import { clearTestRuntime, installTestRuntime } from "./helpers/test-runtime.js";

describe("hook handler order", () => {
  beforeEach(() => {
    installTestRuntime();
  });

  afterEach(() => {
    clearTestRuntime();
  });

  it("invokes llmCall handlers in registration order", async () => {
    const runtime = installTestRuntime();
    const order: string[] = [];
    runtime.hookRegistry.sidecar().on("llmCall", "first", () => {
      order.push("first");
    });
    runtime.hookRegistry.sidecar().on("llmCall", "second", () => {
      order.push("second");
    });

    const record: LLMCallRecord = {
      turn: 1,
      request: { messages: [], system: "", tools: [] },
      outcome: { status: "failed", error: "test" },
    };
    await runtime.hooks.dispatch("llmCall", record);
    expect(order).toEqual(["first", "second"]);
  });
});

describe("hook handler errors", () => {
  beforeEach(() => {
    installTestRuntime();
  });

  afterEach(() => {
    clearTestRuntime();
  });

  it("does not stop subsequent toolUse handlers when one throws", async () => {
    const runtime = installTestRuntime();
    resetRun();
    enableTestCollector();
    const seen: string[] = [];
    runtime.hookRegistry.sidecar().on("toolUse", "throws", () => {
      throw new Error("trace blew up");
    });
    runtime.hookRegistry.sidecar().on("toolUse", "after", () => {
      seen.push("after");
    });

    const record: ToolUseRecord = {
      turn: 1,
      toolName: "read_file",
      toolInput: { path: "a.txt" },
      toolUseId: "tu_1",
      outcome: { status: "succeeded", output: "ok" },
    };
    await runtime.hooks.dispatch("toolUse", record);

    expect(seen).toEqual(["after"]);
    const errors = getCollectedEvents().filter((e) => e.kind === "plugin_error");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.payload.hook).toBe("throws");

    disableTestCollector();
  });
});

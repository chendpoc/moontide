import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { enableTestCollector, disableTestCollector, getCollectedEvents, resetRun } from "../packages/agent-cli/src/log/index.js";
import type { LLMCallRecord, ToolUseRecord } from "../packages/agent/src/agent/pipeline/types.js";
import { clearTestRuntime, installTestRuntime } from "./helpers/test-runtime.js";

describe("run observer handler order", () => {
  beforeEach(() => {
    installTestRuntime();
  });

  afterEach(() => {
    clearTestRuntime();
  });

  it("invokes llmCall handlers in registration order", async () => {
    const runtime = installTestRuntime();
    const order: string[] = [];
    runtime.observerRegistry.sidecar().on("llmCall", "first", () => {
      order.push("first");
    });
    runtime.observerRegistry.sidecar().on("llmCall", "second", () => {
      order.push("second");
    });

    const record: LLMCallRecord = {
      turn: 1,
      request: { messages: [], system: "", tools: [] },
      outcome: { status: "failed", error: "test" },
    };
    await runtime.observers.dispatch("llmCall", record);
    expect(order).toEqual(["first", "second"]);
  });
});

describe("run observer handler errors", () => {
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
    runtime.observerRegistry.sidecar().on("toolUse", "throws", () => {
      throw new Error("trace blew up");
    });
    runtime.observerRegistry.sidecar().on("toolUse", "after", () => {
      seen.push("after");
    });

    const record: ToolUseRecord = {
      turn: 1,
      toolName: "read_file",
      toolInput: { path: "a.txt" },
      toolUseId: "tu_1",
      outcome: { status: "succeeded", output: "ok" },
    };
    await runtime.observers.dispatch("toolUse", record);

    expect(seen).toEqual(["after"]);
    const errors = getCollectedEvents().filter((e) => e.kind === "plugin_error");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.payload.hook).toBe("throws");

    disableTestCollector();
  });
});

import { describe, expect, it } from "vitest";

import { enableTestCollector, disableTestCollector, getCollectedEvents } from "../src/log/event-hub.js";
import { resetRun } from "../src/log/run.js";
import {
  hookDispatcher,
  resetSidecarHooks,
  sidecarHooks,
} from "../src/agent/hooks/index.js";
import type { LLMCallRecord, ToolUseRecord } from "../src/agent/pipeline/types.js";

describe("hook handler order", () => {
  it("invokes llmCall handlers in registration order", async () => {
    resetSidecarHooks();
    const order: string[] = [];
    sidecarHooks().on("llmCall", "first", () => {
      order.push("first");
    });
    sidecarHooks().on("llmCall", "second", () => {
      order.push("second");
    });

    const record: LLMCallRecord = {
      turn: 1,
      request: { messages: [], system: "", tools: [] },
      outcome: { status: "failed", error: "test" },
    };
    await hookDispatcher.dispatch("llmCall", record);
    expect(order).toEqual(["first", "second"]);
  });
});

describe("hook handler errors", () => {
  it("does not stop subsequent toolUse handlers when one throws", async () => {
    resetSidecarHooks();
    resetRun();
    enableTestCollector();
    const seen: string[] = [];
    sidecarHooks().on("toolUse", "throws", () => {
      throw new Error("trace blew up");
    });
    sidecarHooks().on("toolUse", "after", () => {
      seen.push("after");
    });

    const record: ToolUseRecord = {
      turn: 1,
      toolName: "read_file",
      toolInput: { path: "a.txt" },
      toolUseId: "tu_1",
      outcome: { status: "succeeded", output: "ok" },
    };
    await hookDispatcher.dispatch("toolUse", record);

    expect(seen).toEqual(["after"]);
    const errors = getCollectedEvents().filter((e) => e.kind === "plugin_error");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.payload.hook).toBe("throws");

    disableTestCollector();
  });
});

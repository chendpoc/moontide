import { describe, expect, it } from "vitest";

import { enableTestCollector, disableTestCollector, getCollectedEvents } from "../src/events/bus.js";
import { resetRun } from "../src/events/run.js";
import { resetPlugins, setPlugins } from "../src/agent/pipeline/registry.js";
import type { LLMCallRecord, ToolUseRecord } from "../src/agent/pipeline/types.js";
import { notifyPlugins } from "../src/agent/pipeline/notify.js";

describe("pipeline plugin order", () => {
  it("invokes DEFAULT_PLUGINS in registry order", async () => {
    const order: string[] = [];
    setPlugins([
      { name: "first", onLLMCall: () => { order.push("first"); return []; } },
      { name: "second", onLLMCall: () => { order.push("second"); return []; } },
    ]);

    const record: LLMCallRecord = {
      turn: 1,
      request: { messages: [], system: "", tools: [] },
      outcome: { status: "failed", error: "test" },
    };
    await notifyPlugins("onLLMCall", record);
    expect(order).toEqual(["first", "second"]);
    resetPlugins();
  });
});

describe("pipeline plugin errors", () => {
  it("does not stop subsequent plugins when one throws", async () => {
    resetRun();
    enableTestCollector();
    const seen: string[] = [];
    setPlugins([
      {
        name: "throws",
        onToolUse() {
          throw new Error("trace blew up");
        },
      },
      {
        name: "after",
        onToolUse() {
          seen.push("after");
          return [];
        },
      },
    ]);

    const record: ToolUseRecord = {
      turn: 1,
      toolName: "read_file",
      toolInput: { path: "a.txt" },
      toolUseId: "tu_1",
      outcome: { status: "succeeded", output: "ok" },
    };
    await notifyPlugins("onToolUse", record);

    expect(seen).toEqual(["after"]);
    const errors = getCollectedEvents().filter((e) => e.kind === "plugin_error");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.payload.plugin).toBe("throws");

    disableTestCollector();
    resetPlugins();
  });
});

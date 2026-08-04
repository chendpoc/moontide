import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { emitHookError } from "../src/agent/hooks/failures.js";
import {
  disableTestCollector,
  enableTestCollector,
  getCollectedEvents,
} from "../src/log/event-hub.js";
import { resetRun } from "../src/log/run.js";

describe("emitHookError", () => {
  beforeEach(() => {
    resetRun("test-run");
    enableTestCollector();
  });

  afterEach(() => {
    disableTestCollector();
  });

  it("routes toolUse errors to tool_use_log / post_tool", () => {
    emitHookError("toolUse", "tool-use-log", { turn: 2, toolName: "bash", toolUseId: "t1" }, "boom");
    const event = getCollectedEvents().at(-1)!;
    expect(event.channel).toBe("tool_use_log");
    expect(event.phase).toBe("post_tool");
    expect(event.kind).toBe("plugin_error");
  });

  it("routes llmCall errors to context / post_llm", () => {
    emitHookError("llmCall", "context-metrics", { turn: 1 }, "metrics failed");
    const event = getCollectedEvents().at(-1)!;
    expect(event.channel).toBe("context");
    expect(event.phase).toBe("post_llm");
  });

  it("routes runEnd errors to trace / stop", () => {
    emitHookError("runEnd", "derive-final", undefined, "derive failed");
    const event = getCollectedEvents().at(-1)!;
    expect(event.channel).toBe("trace");
    expect(event.phase).toBe("stop");
  });

  it("routes sessionItem errors to trace / pre_llm", () => {
    emitHookError("sessionItem", "file", undefined, "write failed");
    const event = getCollectedEvents().at(-1)!;
    expect(event.channel).toBe("trace");
    expect(event.phase).toBe("pre_llm");
  });
});

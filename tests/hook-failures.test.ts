import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { ErrorCode } from "@moontide/shared/errors/codes.js";
import { infraError } from "@moontide/shared/errors/factories.js";
import { emitObserverError } from "../packages/agent/src/agent/run-observers/failures.js";
import {
  disableTestCollector,
  enableTestCollector,
  getCollectedEvents,
  resetRun,
} from "../packages/agent-cli/src/log/index.js";
import { clearTestRuntime, installTestRuntime } from "./helpers/test-runtime.js";

describe("emitObserverError", () => {
  beforeEach(() => {
    installTestRuntime();
    resetRun("test-run");
    enableTestCollector();
  });

  afterEach(() => {
    disableTestCollector();
    clearTestRuntime();
  });

  it("routes toolUse errors to tool_use_log / post_tool", () => {
    emitObserverError("toolUse", "tool-use-log", { turn: 2, toolName: "bash", toolUseId: "t1" }, "boom");
    const event = getCollectedEvents().at(-1)!;
    expect(event.channel).toBe("tool_use_log");
    expect(event.phase).toBe("post_tool");
    expect(event.kind).toBe("plugin_error");
  });

  it("routes llmCall errors to context / post_llm", () => {
    emitObserverError("llmCall", "context-metrics", { turn: 1 }, "metrics failed");
    const event = getCollectedEvents().at(-1)!;
    expect(event.channel).toBe("context");
    expect(event.phase).toBe("post_llm");
  });

  it("routes runEnd errors to trace / stop", () => {
    emitObserverError("runEnd", "derive-final", undefined, "derive failed");
    const event = getCollectedEvents().at(-1)!;
    expect(event.channel).toBe("trace");
    expect(event.phase).toBe("stop");
  });

  it("routes sessionItem errors to trace / pre_llm", () => {
    emitObserverError("sessionItem", "file", undefined, "write failed");
    const event = getCollectedEvents().at(-1)!;
    expect(event.channel).toBe("trace");
    expect(event.phase).toBe("pre_llm");
  });

  it("includes structured errorCode in plugin_error payload", () => {
    emitObserverError("toolUse", "tool-use-log", { turn: 2, toolName: "bash", toolUseId: "t1" }, "boom");
    const event = getCollectedEvents().at(-1)!;
    expect(event.payload.errorCode).toBe(ErrorCode.INTERNAL);
    expect(event.payload.message).toBe("boom");
    expect(event.payload.source).toBe("hook:tool-use-log");
  });

  it("maps AppError code into plugin_error payload", () => {
    emitObserverError("llmCall", "context-metrics", { turn: 1 }, infraError("metrics failed", { context: { url: "x" } }));
    const event = getCollectedEvents().at(-1)!;
    expect(event.payload.errorCode).toBe(ErrorCode.INFRA);
    expect(event.payload.context).toEqual({ url: "x" });
  });
});

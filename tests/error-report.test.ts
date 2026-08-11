import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ErrorCode } from "@moontide/shared/errors/codes.js";
import { reportError } from "../packages/agent-cli/src/errors/report.js";
import {
  disableTestCollector,
  enableTestCollector,
  getCollectedEvents,
  resetRun,
} from "../packages/agent-cli/src/log/index.js";
import { setDebugOverride, resetDebugOverride } from "../packages/agent/src/context-inspect/debug-mode.js";
import { createTestEventPipeline } from "@moontide/agent/testing";
import { setStderrWriterForTest } from "../packages/agent-cli/src/terminal/write.js";
import { stripAnsi } from "@moontide/shared/utils/text.js";
import { clearTestRuntime, installTestRuntime } from "./helpers/test-runtime.js";

describe("reportError", () => {
  let stderr = "";
  let debugTerminal: string[] = [];

  beforeEach(() => {
    stderr = "";
    debugTerminal = [];
    resetRun("report-run");
    enableTestCollector();
    resetDebugOverride();
    setStderrWriterForTest((chunk) => {
      stderr += chunk;
      return true;
    });
    installTestRuntime(undefined, createTestEventPipeline({ debugTerminal }));
  });

  afterEach(() => {
    disableTestCollector();
    resetDebugOverride();
    setStderrWriterForTest(null);
    clearTestRuntime();
  });

  it("writes stderr and emits plugin_error when routed", () => {
    reportError(
      {
        code: ErrorCode.INTERNAL,
        message: "hook failed",
        source: "hook:context-metrics",
        hook: "context-metrics",
        turn: 1,
      },
      {
        route: { channel: "context", phase: "post_llm", turn: 1, hook: "context-metrics" },
      },
    );

    const plain = stripAnsi(stderr);
    expect(plain).toContain("ERROR");
    expect(plain).toContain("hook failed");

    const event = getCollectedEvents().at(-1)!;
    expect(event.kind).toBe("plugin_error");
    expect(event.channel).toBe("context");
    expect(event.payload.errorCode).toBe(ErrorCode.INTERNAL);
    expect(event.payload.message).toBe("hook failed");
  });

  it("emits debug error record when debug file tier is on", () => {
    setDebugOverride("file");
    reportError(
      {
        code: ErrorCode.INFRA,
        message: "network down",
        source: "pipeline:runLLM",
        turn: 3,
      },
      { route: { channel: "trace", phase: "post_llm", turn: 3 }, stderr: false },
    );

    const debugText = debugTerminal.join("\n");
    expect(debugText).toContain('"kind": "error"');
    expect(debugText).toContain("network down");
  });
});

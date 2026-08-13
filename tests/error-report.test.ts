import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ErrorCode } from "@moontide/shared/errors/codes.js";
import { getWorkdir, setWorkdir } from "../packages/agent/src/config.js";
import { debugLogPath } from "../packages/agent/src/context-inspect/debug-file.js";
import { reportError } from "../packages/agent-cli/src/errors/report.js";
import {
  disableTestCollector,
  enableTestCollector,
  getCollectedEvents,
  resetRun,
} from "../packages/agent-cli/src/log/index.js";
import { setDebugOverride, resetDebugOverride } from "../packages/agent/src/context-inspect/debug-mode.js";
import { createTestEventOutputs } from "@moontide/agent/testing";
import { setStderrWriterForTest } from "../packages/agent-cli/src/terminal/write.js";
import { stripAnsi } from "@moontide/shared/utils/text.js";
import { clearTestRuntime, installTestRuntime } from "./helpers/test-runtime.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";

describe("reportError", () => {
  let stderr = "";
  let tmpDir = "";
  let originalWorkdir = "";

  beforeEach(() => {
    stderr = "";
    originalWorkdir = getWorkdir();
    tmpDir = createTmpWorkdir("moontide-error-report-");
    setWorkdir(tmpDir);
    resetRun("report-run");
    enableTestCollector();
    resetDebugOverride();
    setStderrWriterForTest((chunk) => {
      stderr += chunk;
      return true;
    });
    installTestRuntime(tmpDir, createTestEventOutputs());
  });

  afterEach(() => {
    disableTestCollector();
    resetDebugOverride();
    setStderrWriterForTest(null);
    clearTestRuntime();
    setWorkdir(originalWorkdir);
    removeTmpWorkdir(tmpDir);
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

  it("writes debug error record to jsonl when debug file tier is on", () => {
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

    const path = debugLogPath(tmpDir);
    expect(fs.existsSync(path)).toBe(true);
    const line = fs.readFileSync(path, "utf8").trim();
    const record = JSON.parse(line) as { kind: string; message: string };
    expect(record.kind).toBe("error");
    expect(record.message).toBe("network down");
  });
});

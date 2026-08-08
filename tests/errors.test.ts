import { describe, expect, it } from "vitest";

import { ErrorCode } from "@moontide/shared/errors/codes.js";
import {
  configError,
  infraError,
  internalError,
  toolError,
  validationError,
} from "@moontide/shared/errors/factories.js";
import { errorCodeOf, toMessage, toStack } from "@moontide/shared/errors/normalize.js";
import { isAppError } from "@moontide/shared/errors/app-error.js";
import {
  errorCodeFromToolOutcome,
  toFailureOutcome,
  toolFailureMessage,
} from "@moontide/shared/errors/outcome.js";
import { isErrorRecord, toErrorRecord } from "@moontide/shared/errors/record.js";

describe("AppError", () => {
  it("carries code and context", () => {
    const err = infraError("fetch failed", { context: { url: "https://x.test" } });
    expect(isAppError(err)).toBe(true);
    expect(err.code).toBe(ErrorCode.INFRA);
    expect(err.message).toBe("fetch failed");
    expect(err.context).toEqual({ url: "https://x.test" });
  });

  it("preserves cause chain message in toErrorRecord", () => {
    const cause = new Error("root");
    const err = toolError("wrapped", { cause });
    const record = toErrorRecord(err, "test");
    expect(record.cause).toBe("root");
  });
});

describe("normalize", () => {
  it("toMessage handles strings and unknown values", () => {
    expect(toMessage("plain")).toBe("plain");
    expect(toMessage(42)).toBe("42");
    expect(toMessage(new Error("boom"))).toBe("boom");
    expect(toMessage(validationError("bad"))).toBe("bad");
  });

  it("errorCodeOf defaults to internal for unknown errors", () => {
    expect(errorCodeOf(new Error("x"))).toBe(ErrorCode.INTERNAL);
    expect(errorCodeOf(configError("missing key"))).toBe(ErrorCode.CONFIG);
  });

  it("toStack returns stack for Error instances", () => {
    const err = new Error("stack me");
    expect(toStack(err)).toContain("stack me");
    expect(toStack("nope")).toBeUndefined();
  });
});

describe("outcome helpers", () => {
  it("toolFailureMessage prefixes Error:", () => {
    expect(toolFailureMessage("ENOENT")).toBe("Error: ENOENT");
  });

  it("toFailureOutcome wraps unknown errors", () => {
    expect(toFailureOutcome("timeout")).toEqual({ status: "failed", error: "timeout" });
  });

  it("errorCodeFromToolOutcome maps permission and tool failures", () => {
    expect(errorCodeFromToolOutcome({ status: "denied" })).toBe(ErrorCode.PERMISSION);
    expect(errorCodeFromToolOutcome({ status: "rejected" })).toBe(ErrorCode.PERMISSION);
    expect(errorCodeFromToolOutcome({ status: "failed", error: "x" })).toBe(ErrorCode.TOOL);
    expect(errorCodeFromToolOutcome({ status: "succeeded" })).toBe(ErrorCode.INTERNAL);
  });
});

describe("toErrorRecord", () => {
  it("builds a stable ErrorRecord shape", () => {
    const record = toErrorRecord(internalError("invariant"), "pipeline:runLLM", {
      turn: 2,
      toolName: "bash",
    });
    expect(record.code).toBe(ErrorCode.INTERNAL);
    expect(record.source).toBe("pipeline:runLLM");
    expect(record.turn).toBe(2);
    expect(record.toolName).toBe("bash");
    expect(isErrorRecord(record)).toBe(true);
  });

  it("AppError code wins over extras", () => {
    const record = toErrorRecord(validationError("bad spec"), "define-tool");
    expect(record.code).toBe(ErrorCode.VALIDATION);
  });
});

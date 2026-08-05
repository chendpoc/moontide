import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TOOL_NAMES } from "../src/tools/names.js";
import { checkPermission } from "../src/agent/pipeline/permission/index.js";
import { clearTestRuntime, getTestRuntime, installTestRuntime } from "./helpers/test-runtime.js";

describe("permissions", () => {
  beforeEach(() => {
    installTestRuntime();
  });

  afterEach(() => {
    clearTestRuntime();
  });

  it("denies rm -rf / via bash", () => {
    expect(checkPermission(TOOL_NAMES.BASH, { command: "rm -rf /" }, getTestRuntime())).toBe("deny");
  });

  it("asks for destructive rm via bash", () => {
    expect(checkPermission(TOOL_NAMES.BASH, { command: "rm foo.txt" }, getTestRuntime())).toBe("ask");
  });

  it("allows safe bash", () => {
    expect(checkPermission(TOOL_NAMES.BASH, { command: "echo hi" }, getTestRuntime())).toBe("allow");
  });

  it("allows write inside workspace", () => {
    expect(checkPermission(TOOL_NAMES.WRITE_FILE, { path: "ok.txt", content: "hi" }, getTestRuntime())).toBe("allow");
  });

  it("asks when read_file path escapes workspace", () => {
    expect(checkPermission(TOOL_NAMES.READ_FILE, { path: "../../../etc/passwd" }, getTestRuntime())).toBe("ask");
  });

  it("allows code_repl including dangerous-looking inline code", () => {
    expect(checkPermission(TOOL_NAMES.CODE_REPL, { code: "rm -rf /", runtime: "python" }, getTestRuntime())).toBe("allow");
  });

  it("asks before deep_research network tool", () => {
    process.env.MOONTIDE_DEEP_RESEARCH = "1";
    installTestRuntime();
    expect(checkPermission(TOOL_NAMES.DEEP_RESEARCH, { query: "latest LLM papers" }, getTestRuntime())).toBe("ask");
    delete process.env.MOONTIDE_DEEP_RESEARCH;
  });

  it("asks before http_fetch", () => {
    expect(checkPermission(TOOL_NAMES.HTTP_FETCH, { url: "https://example.com" }, getTestRuntime())).toBe("ask");
  });

  it("asks for bash curl", () => {
    expect(checkPermission(TOOL_NAMES.BASH, { command: "curl https://example.com" }, getTestRuntime())).toBe("ask");
  });

  it("asks for bash rg", () => {
    expect(checkPermission(TOOL_NAMES.BASH, { command: "rg TODO src" }, getTestRuntime())).toBe("ask");
  });

  it("asks for bash git status", () => {
    expect(checkPermission(TOOL_NAMES.BASH, { command: "git status" }, getTestRuntime())).toBe("ask");
  });

  it("asks when list_dir path escapes workspace", () => {
    expect(checkPermission(TOOL_NAMES.LIST_DIR, { path: "../../../etc/passwd" }, getTestRuntime())).toBe("ask");
  });

  it("asks when grep path escapes workspace", () => {
    expect(checkPermission(TOOL_NAMES.GREP, { pattern: "foo", path: "../../../etc/passwd" }, getTestRuntime())).toBe(
      "ask",
    );
  });

  it("denies unknown tools", () => {
    expect(checkPermission("not_a_real_tool", {}, getTestRuntime())).toBe("deny");
  });
});

import { describe, expect, it } from "vitest";

import { TOOL_NAMES } from "../src/agent/tools/names.js";
import { checkPermission } from "../src/agent/pipeline/permission/index.js";

describe("permissions", () => {
  it("denies rm -rf / via bash", () => {
    expect(checkPermission(TOOL_NAMES.BASH, { command: "rm -rf /" })).toBe("deny");
  });

  it("asks for destructive rm via bash", () => {
    expect(checkPermission(TOOL_NAMES.BASH, { command: "rm foo.txt" })).toBe("ask");
  });

  it("allows safe bash", () => {
    expect(checkPermission(TOOL_NAMES.BASH, { command: "echo hi" })).toBe("allow");
  });

  it("allows write inside workspace", () => {
    expect(checkPermission(TOOL_NAMES.WRITE_FILE, { path: "ok.txt", content: "hi" })).toBe("allow");
  });

  it("asks when read_file path escapes workspace", () => {
    expect(checkPermission(TOOL_NAMES.READ_FILE, { path: "../../../etc/passwd" })).toBe("ask");
  });

  it("allows code_repl including dangerous-looking inline code", () => {
    expect(checkPermission(TOOL_NAMES.CODE_REPL, { code: "rm -rf /", runtime: "python" })).toBe("allow");
  });

  it("asks before deep_research network tool", () => {
    expect(checkPermission(TOOL_NAMES.DEEP_RESEARCH, { query: "latest LLM papers" })).toBe("ask");
  });

  it("asks before http_fetch", () => {
    expect(checkPermission(TOOL_NAMES.HTTP_FETCH, { url: "https://example.com" })).toBe("ask");
  });

  it("asks for bash curl", () => {
    expect(checkPermission(TOOL_NAMES.BASH, { command: "curl https://example.com" })).toBe("ask");
  });

  it("asks for bash rg", () => {
    expect(checkPermission(TOOL_NAMES.BASH, { command: "rg TODO src" })).toBe("ask");
  });

  it("asks for bash git status", () => {
    expect(checkPermission(TOOL_NAMES.BASH, { command: "git status" })).toBe("ask");
  });
});

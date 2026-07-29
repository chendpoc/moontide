import { describe, expect, it } from "vitest";

import { checkPermission } from "../src/permission/index.js";

describe("permissions", () => {
  it("denies rm -rf / via bash", () => {
    expect(checkPermission("bash", { command: "rm -rf /" })).toBe("deny");
  });

  it("asks for destructive rm via bash", () => {
    expect(checkPermission("bash", { command: "rm foo.txt" })).toBe("ask");
  });

  it("allows safe bash", () => {
    expect(checkPermission("bash", { command: "echo hi" })).toBe("allow");
  });

  it("allows write inside workspace", () => {
    expect(checkPermission("write_file", { path: "ok.txt", content: "hi" })).toBe("allow");
  });

  it("asks when read_file path escapes workspace", () => {
    expect(checkPermission("read_file", { path: "../../../etc/passwd" })).toBe("ask");
  });

  it("allows code_repl including dangerous-looking inline code", () => {
    expect(checkPermission("code_repl", { code: "rm -rf /", runtime: "python" })).toBe("allow");
  });

  it("asks before deep_research network tool", () => {
    expect(checkPermission("deep_research", { query: "latest LLM papers" })).toBe("ask");
  });
});

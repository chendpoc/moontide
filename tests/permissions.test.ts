import { describe, expect, it } from "vitest";

import { checkPermission } from "../src/permissions.js";

describe("permissions", () => {
  it("denies rm -rf /", () => {
    expect(checkPermission("bash", { command: "rm -rf /" })).toBe("deny");
  });

  it("asks for destructive rm", () => {
    expect(checkPermission("bash", { command: "rm foo.txt" })).toBe("ask");
  });

  it("allows safe bash", () => {
    expect(checkPermission("bash", { command: "echo hi" })).toBe("allow");
  });

  it("allows write inside workspace", () => {
    expect(checkPermission("write_file", { path: "ok.txt", content: "hi" })).toBe("allow");
  });

  it("denies dangerous code_repl inline code", () => {
    expect(checkPermission("code_repl", { code: "rm -rf /", runtime: "bash" })).toBe("deny");
  });
});

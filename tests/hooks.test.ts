import { describe, expect, it } from "vitest";

import { runHooks, setupDefaultHooks } from "../src/agent/hooks.js";
import { checkPermission } from "../src/permission/index.js";

describe("agent hooks defaults", () => {
  it("PreToolUse blocks deny decisions via checkPermission", () => {
    setupDefaultHooks();
    const blocked = runHooks("PreToolUse", {
      turn: 1,
      tool_name: "bash",
      tool_input: { command: "sudo rm -rf /" },
    });
    expect(blocked).toContain("Permission denied");
    expect(checkPermission("bash", { command: "sudo rm -rf /" })).toBe("deny");
  });

  it("PreToolUse allows tools that need user ask", () => {
    setupDefaultHooks();
    const blocked = runHooks("PreToolUse", {
      turn: 1,
      tool_name: "http_fetch",
      tool_input: { url: "https://example.com" },
    });
    expect(blocked).toBeNull();
  });
});

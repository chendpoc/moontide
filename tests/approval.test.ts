import { describe, expect, it } from "vitest";

import {
  promptToolApproval,
  setToolApprovalPrompt,
} from "../src/cli/approval.js";

describe("tool approval", () => {
  it("returns false when no prompt configured", async () => {
    setToolApprovalPrompt(null);
    const ok = await promptToolApproval({
      turn: 1,
      toolName: "Bash",
      toolInput: { command: "rm x" },
    });
    expect(ok).toBe(false);
  });

  it("delegates to injected prompt", async () => {
    setToolApprovalPrompt(async () => true);
    const ok = await promptToolApproval({
      turn: 1,
      toolName: "Bash",
      toolInput: { command: "rm x" },
    });
    expect(ok).toBe(true);
    setToolApprovalPrompt(null);
  });
});

import { describe, expect, it } from "vitest";

import {
  ORIENT_PROTOCOL_REMINDER_TEXT,
  shouldSendOrientProtocolReminder,
  SYNTHESIZE_PROTOCOL_REMINDER_TEXT,
} from "../apps/moontide/src/agent/deep-task-protocol.js";
import { TOOL_NAMES } from "@moontide/tools";

describe("deep task protocol reminders", () => {
  it("exports orient and synthesize reminder copy", () => {
    expect(ORIENT_PROTOCOL_REMINDER_TEXT).toContain("work_mem");
    expect(SYNTHESIZE_PROTOCOL_REMINDER_TEXT).toContain("decision");
  });

  it("detects orient reminder when non-work_mem tools run first", () => {
    const blocks = [
      {
        type: "tool_use" as const,
        id: "tu_1",
        name: TOOL_NAMES.READ_FILE,
        input: { path: "demo.txt" },
      },
    ];
    expect(shouldSendOrientProtocolReminder(blocks)).toBe(true);
  });

  it("skips orient reminder when work_mem is used", () => {
    const blocks = [
      {
        type: "tool_use" as const,
        id: "tu_1",
        name: TOOL_NAMES.WORK_MEM,
        input: { action: "draft", kind: "outline" },
      },
    ];
    expect(shouldSendOrientProtocolReminder(blocks)).toBe(false);
  });
});

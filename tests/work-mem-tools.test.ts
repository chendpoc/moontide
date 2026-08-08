import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyDeepPromptGate, resetDeepModeOnNewSession } from "../apps/moontide/src/agent/deep-mode.js";
import { TOOL_NAMES } from "@moontide/tools";
import { defineWorkMemTools } from "@moontide/tools";

describe("work_mem tool description", () => {
  beforeEach(() => {
    resetDeepModeOnNewSession();
    applyDeepPromptGate("deep: investigate auth", "sess-desc");
  });

  afterEach(() => {
    resetDeepModeOnNewSession();
  });

  it("exposes deep-mode guidance with rhythm, draft kinds, and pack triggers", () => {
    const tools = defineWorkMemTools();
    expect(tools).not.toBeNull();

    const workMem = tools!.find((tool) => tool.schema.name === TOOL_NAMES.WORK_MEM);
    expect(workMem).toBeDefined();

    const description = workMem!.schema.description;
    expect(description).toContain("kind outline");
    expect(description).toContain("hypothesis");
    expect(description).toContain("Working Set");
    expect(description).toContain("summarize or refine");

    const properties = workMem!.schema.input_schema.properties as Record<
      string,
      { description?: string }
    >;
    expect(properties.action?.description).toContain("draft:");
    expect(properties.kind?.description).toContain("outline:");
    expect(properties.ref?.description).toContain("src/foo.ts");
  });
});

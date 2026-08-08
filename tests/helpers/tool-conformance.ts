import { expect } from "vitest";

import { toolDefinitionToSpec, validateToolSpec } from "@moontide/tools";
import { TOOL_CAPABILITIES } from "@moontide/tools";
import { TOOL_NAMES, type ToolName } from "@moontide/tools";
import { TOOL_PERMISSIONS } from "@moontide/tools";
import type { ToolDefinition } from "@moontide/tools";

export function assertToolRegistryConformance(tools: ToolDefinition[]): void {
  const names = tools.map((tool) => tool.schema.name);
  expect(new Set(names).size).toBe(names.length);

  const canonical = new Set(Object.values(TOOL_NAMES));

  for (const tool of tools) {
    expect(tool.schema.description.length).toBeGreaterThan(0);
    expect(tool.schema.input_schema).toBeTruthy();
    expect(typeof tool.handler).toBe("function");
    expect(tool.permission).toBeTruthy();
    expect(["fixed", "bash", "path"]).toContain(tool.permission.kind);
    expect(tool.capability).toBeTruthy();
    expect(canonical.has(tool.schema.name as ToolName)).toBe(true);

    const name = tool.schema.name as ToolName;
    expect(TOOL_PERMISSIONS[name]).toEqual(tool.permission);
    expect(TOOL_CAPABILITIES[name]).toBe(tool.capability);

    validateToolSpec(toolDefinitionToSpec(tool));

    if (tool.permission.kind === "fixed") {
      expect(["allow", "deny", "ask"]).toContain(tool.permission.decision);
    }
  }

  for (const name of Object.values(TOOL_NAMES)) {
    expect(TOOL_PERMISSIONS[name as ToolName]).toBeTruthy();
    expect(TOOL_CAPABILITIES[name as ToolName]).toBeTruthy();
  }
}

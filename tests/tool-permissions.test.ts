import { describe, expect, it } from "vitest";

import { TOOL_NAMES, type ToolName } from "../src/tools/names.js";
import { TOOL_PERMISSIONS } from "../src/tools/permission-table.js";
import { registerDefaultTools } from "../src/tools/register-defaults.js";

describe("tool permission conformance", () => {
  it("registerDefaultTools exposes unique names with schema and permission", () => {
    const tools = registerDefaultTools();
    const names = tools.map((tool) => tool.schema.name);
    expect(new Set(names).size).toBe(names.length);

    for (const tool of tools) {
      expect(tool.schema.description.length).toBeGreaterThan(0);
      expect(tool.schema.input_schema).toBeTruthy();
      expect(typeof tool.handler).toBe("function");
      expect(tool.permission).toBeTruthy();
      expect(["fixed", "bash", "path"]).toContain(tool.permission.kind);
    }
  });

  it("fixed permission rules use allow, deny, or ask", () => {
    for (const tool of registerDefaultTools()) {
      if (tool.permission.kind !== "fixed") {
        continue;
      }
      expect(["allow", "deny", "ask"]).toContain(tool.permission.decision);
    }
  });

  it("every registered tool name is a canonical TOOL_NAMES entry", () => {
    const canonical = new Set(Object.values(TOOL_NAMES));
    for (const tool of registerDefaultTools()) {
      expect(canonical.has(tool.schema.name as ToolName)).toBe(true);
    }
  });

  it("registered tools match TOOL_PERMISSIONS table", () => {
    for (const tool of registerDefaultTools()) {
      const name = tool.schema.name as ToolName;
      expect(TOOL_PERMISSIONS[name]).toEqual(tool.permission);
    }
  });

  it("TOOL_PERMISSIONS covers every TOOL_NAMES entry", () => {
    for (const name of Object.values(TOOL_NAMES)) {
      expect(TOOL_PERMISSIONS[name as ToolName]).toBeTruthy();
    }
  });
});

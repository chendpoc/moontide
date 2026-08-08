import { describe, expect, it } from "vitest";

import { TOOL_CAPABILITIES } from "@moontide/tools";
import { TOOL_NAMES, type ToolName } from "@moontide/tools";
import { TOOL_PERMISSIONS } from "@moontide/tools";
import { registerDefaultTools } from "../apps/moontide/src/tools/register-defaults.js";
import { assertToolRegistryConformance } from "./helpers/tool-conformance.js";

describe("tool permission conformance", () => {
  it("registerDefaultTools passes registry conformance", () => {
    assertToolRegistryConformance(registerDefaultTools());
  });

  it("TOOL_PERMISSIONS covers every TOOL_NAMES entry", () => {
    for (const name of Object.values(TOOL_NAMES)) {
      expect(TOOL_PERMISSIONS[name as ToolName]).toBeTruthy();
    }
  });

  it("TOOL_CAPABILITIES covers every TOOL_NAMES entry", () => {
    for (const name of Object.values(TOOL_NAMES)) {
      expect(TOOL_CAPABILITIES[name as ToolName]).toBeTruthy();
    }
  });
});

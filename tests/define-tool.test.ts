import { describe, expect, it } from "vitest";

import { defineTool, defineTools, resolveToolManifest, validateToolSpec } from "@moontide/tools";
import { ErrorCode } from "@moontide/shared/errors/codes.js";
import { isAppError } from "@moontide/shared/errors/app-error.js";
import type { ToolDefinition } from "@moontide/tools";

describe("defineTools", () => {
  it("builds definitions from specs", () => {
    const tools = defineTools([
      {
        name: "echo",
        description: "echo",
        input_schema: { type: "object", properties: {} },
        permission: { kind: "fixed", decision: "allow" },
        capability: "read",
        run: () => "ok",
      },
    ]);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.schema.name).toBe("echo");
    expect(tools[0]?.handler({}, {} as never)).toBe("ok");
  });

  it("skips disabled specs", () => {
    const tools = defineTools([
      {
        name: "off",
        description: "off",
        input_schema: { type: "object", properties: {} },
        permission: { kind: "fixed", decision: "deny" },
        capability: "read",
        enabled: () => false,
        run: () => "nope",
      },
    ]);
    expect(tools).toHaveLength(0);
  });
});

describe("defineTool", () => {
  it("requires capability", () => {
    expect(() =>
      defineTool({
        name: "bad",
        description: "bad",
        input_schema: { type: "object", properties: {} },
        permission: { kind: "fixed", decision: "allow" },
        capability: "read",
        run: () => "",
      }),
    ).not.toThrow();
  });
});

describe("validateToolSpec", () => {
  it("rejects path permission without matching schema field", () => {
    expect(() =>
      validateToolSpec({
        name: "bad",
        description: "bad",
        input_schema: { type: "object", properties: {} },
        permission: { kind: "path", field: "path" },
        capability: "read",
        run: () => "",
      }),
    ).toThrow(/requires input_schema.properties.path/);
    try {
      validateToolSpec({
        name: "bad",
        description: "bad",
        input_schema: { type: "object", properties: {} },
        permission: { kind: "path", field: "path" },
        capability: "read",
        run: () => "",
      });
    } catch (err) {
      expect(isAppError(err)).toBe(true);
      if (isAppError(err)) {
        expect(err.code).toBe(ErrorCode.VALIDATION);
      }
    }
  });
});

describe("resolveToolManifest", () => {
  it("skips optional null factories", () => {
    const tools = resolveToolManifest([
      {
        factory: () => [
          {
            schema: { name: "a", description: "a", input_schema: { type: "object", properties: {} } },
            handler: () => "",
            permission: { kind: "fixed", decision: "allow" },
            capability: "read",
          },
        ],
      },
      { factory: (): ToolDefinition[] | null => null, optional: true },
    ]);
    expect(tools).toHaveLength(1);
  });
});

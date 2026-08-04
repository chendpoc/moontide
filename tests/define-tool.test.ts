import { describe, expect, it } from "vitest";

import { defineTools, resolveToolManifest } from "../src/tools/define-tool.js";
import type { ToolDefinition } from "../src/tools/types.js";

describe("defineTools", () => {
  it("builds definitions from specs", () => {
    const tools = defineTools([
      {
        name: "echo",
        description: "echo",
        input_schema: { type: "object", properties: {} },
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
        enabled: () => false,
        run: () => "nope",
      },
    ]);
    expect(tools).toHaveLength(0);
  });
});

describe("resolveToolManifest", () => {
  it("skips optional null factories", () => {
    const tools = resolveToolManifest([
      {
        factory: () => [{ schema: { name: "a", description: "a", input_schema: {} }, handler: () => "" }],
      },
      { factory: (): ToolDefinition[] | null => null, optional: true },
    ]);
    expect(tools).toHaveLength(1);
  });
});

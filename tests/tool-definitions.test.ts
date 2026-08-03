import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveToolDefinitions } from "../src/context/composer/tool-definitions/index.js";
import { getToolDefinitions, registerDefaultTools, resetTools } from "../src/tools/index.js";

const DEEP_RESEARCH_ENV = "OCULA_DEEP_RESEARCH";

describe("tool definitions", () => {
  beforeEach(() => {
    delete process.env[DEEP_RESEARCH_ENV];
    resetTools();
  });

  afterEach(() => {
    delete process.env[DEEP_RESEARCH_ENV];
    resetTools();
  });

  it("getToolDefinitions returns ToolSchema shape for default tools", () => {
    const schemas = getToolDefinitions();
    expect(schemas.length).toBeGreaterThan(0);
    for (const schema of schemas) {
      expect(schema).toMatchObject({
        name: expect.any(String),
        description: expect.any(String),
        input_schema: expect.any(Object),
      });
    }
  });

  it("omits deep_research unless OCULA_DEEP_RESEARCH=1", () => {
    const names = getToolDefinitions().map((s) => s.name);
    expect(names).not.toContain("deep_research");

    process.env[DEEP_RESEARCH_ENV] = "1";
    resetTools();
    const enabled = getToolDefinitions().map((s) => s.name);
    expect(enabled).toContain("deep_research");
  });

  it("resolveToolDefinitions returns stable name-sorted schemas", () => {
    const resolved = resolveToolDefinitions();
    const names = resolved.map((s) => s.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(resolved.length).toBe(registerDefaultTools().length);
  });

  it("resolveToolDefinitions matches getToolDefinitions content", () => {
    const fromStore = [...getToolDefinitions()].sort((a, b) => a.name.localeCompare(b.name));
    expect(resolveToolDefinitions()).toEqual(fromStore);
  });
});

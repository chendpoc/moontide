import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveToolDefinitions } from "@moontide/context-composer";
import { getToolDefinitions, registerDefaultTools } from "../packages/agent/src/tools/index.js";
import { clearTestRuntime, getTestRuntime, installTestRuntime } from "./helpers/test-runtime.js";

const DEEP_RESEARCH_ENV = "MOONTIDE_DEEP_RESEARCH";

describe("tool definitions", () => {
  beforeEach(() => {
    delete process.env[DEEP_RESEARCH_ENV];
    installTestRuntime();
  });

  afterEach(() => {
    delete process.env[DEEP_RESEARCH_ENV];
    clearTestRuntime();
  });

  it("getToolDefinitions returns ToolSchema shape for default tools", () => {
    const runtime = getTestRuntime();
    const schemas = getToolDefinitions(runtime.tools);
    expect(schemas.length).toBeGreaterThan(0);
    for (const schema of schemas) {
      expect(schema).toMatchObject({
        name: expect.any(String),
        description: expect.any(String),
        input_schema: expect.any(Object),
      });
    }
  });

  it("omits deep_research unless MOONTIDE_DEEP_RESEARCH=1", () => {
    const runtime = getTestRuntime();
    const names = getToolDefinitions(runtime.tools).map((s) => s.name);
    expect(names).not.toContain("deep_research");

    process.env[DEEP_RESEARCH_ENV] = "1";
    runtime.tools.reset();
    const enabled = getToolDefinitions(runtime.tools).map((s) => s.name);
    expect(enabled).toContain("deep_research");
  });

  it("resolveToolDefinitions returns stable name-sorted schemas", () => {
    const runtime = getTestRuntime();
    const resolved = resolveToolDefinitions(runtime.tools);
    const names = resolved.map((s) => s.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(resolved.length).toBe(registerDefaultTools().length);
  });

  it("resolveToolDefinitions matches getToolDefinitions content", () => {
    const runtime = getTestRuntime();
    const fromStore = [...getToolDefinitions(runtime.tools)].sort((a, b) => a.name.localeCompare(b.name));
    expect(resolveToolDefinitions(runtime.tools)).toEqual(fromStore);
  });
});

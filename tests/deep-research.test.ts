import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDefaultCatalog } from "../src/register-defaults.js";
import { runDeepResearch } from "../src/extensions/deep-research/handler.js";
import { defineDeepResearchTool } from "../src/extensions/deep-research/index.js";

const ENV_KEY = "OCULEAU_DEEP_RESEARCH";

describe("deep_research extension template", () => {
  beforeEach(() => {
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it("is omitted from catalog unless OCULEAU_DEEP_RESEARCH=1", () => {
    expect(defineDeepResearchTool()).toBeNull();
    const names = createDefaultCatalog()
      .schemas()
      .map((tool) => tool.name);
    expect(names).not.toContain("deep_research");
  });

  it("registers when OCULEAU_DEEP_RESEARCH=1", () => {
    process.env[ENV_KEY] = "1";
    const tool = defineDeepResearchTool();
    expect(tool?.schema.name).toBe("deep_research");

    const names = createDefaultCatalog()
      .schemas()
      .map((t) => t.name);
    expect(names).toContain("deep_research");
  });

  it("returns not_implemented stub from handler", async () => {
    const raw = await runDeepResearch({ query: "transformer architecture" });
    const result = JSON.parse(raw) as { status: string; query: string };
    expect(result.status).toBe("not_implemented");
    expect(result.query).toBe("transformer architecture");
  });

  it("requires query", async () => {
    const raw = await runDeepResearch({ query: "  " });
    const result = JSON.parse(raw) as { status: string; error: string };
    expect(result.status).toBe("error");
    expect(result.error).toContain("query");
  });
});

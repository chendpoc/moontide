import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerDefaultTools } from "../src/tools/register-defaults.js";
import { runDeepResearch } from "../src/extensions/deep-research/handler.js";
import { defineDeepResearchTool } from "../src/extensions/deep-research/index.js";
import { normalizeMaxResults, tavilySearch } from "../src/extensions/deep-research/tavily.js";

const ENV_KEY = "OCULA_DEEP_RESEARCH";
const TAVILY_KEY = "OCULA_TAVILY_API_KEY";

describe("deep_research extension", () => {
  beforeEach(() => {
    delete process.env[ENV_KEY];
    delete process.env[TAVILY_KEY];
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete process.env[ENV_KEY];
    delete process.env[TAVILY_KEY];
    vi.restoreAllMocks();
  });

  it("is omitted from tool definitions unless OCULA_DEEP_RESEARCH=1", () => {
    expect(defineDeepResearchTool()).toBeNull();
    const names = registerDefaultTools().map((tool) => tool.schema.name);
    expect(names).not.toContain("deep_research");
  });

  it("registers when OCULA_DEEP_RESEARCH=1", () => {
    process.env[ENV_KEY] = "1";
    const tool = defineDeepResearchTool();
    expect(tool?.schema.name).toBe("deep_research");

    const names = registerDefaultTools().map((t) => t.schema.name);
    expect(names).toContain("deep_research");
  });

  it("requires query", async () => {
    const raw = await runDeepResearch({ query: "  " });
    const result = JSON.parse(raw) as { status: string; error: string };
    expect(result.status).toBe("error");
    expect(result.error).toContain("query");
  });

  it("returns Tavily results from handler", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          results: [
            {
              title: "Transformer Architecture",
              url: "https://example.com/transformer",
              content: "Attention is all you need.",
            },
          ],
        }),
      ),
    );

    const raw = await runDeepResearch({ query: "transformer architecture" });
    const result = JSON.parse(raw) as {
      status: string;
      query: string;
      results: Array<{ title: string; url: string; snippet: string; source: string }>;
    };

    expect(result.status).toBe("ok");
    expect(result.query).toBe("transformer architecture");
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toEqual({
      title: "Transformer Architecture",
      url: "https://example.com/transformer",
      snippet: "Attention is all you need.",
      source: "tavily",
    });
  });

  it("uses keyless header when no API key is set", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ results: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await tavilySearch("test query");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Tavily-Access-Mode"]).toBe("keyless");
    expect(headers.Authorization).toBeUndefined();
  });

  it("uses Bearer auth when API key is set", async () => {
    process.env[TAVILY_KEY] = "tvly-test-key";
    const fetchMock = vi.fn(async () =>
      Response.json({ results: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await tavilySearch("test query");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tvly-test-key");
    expect(headers["X-Tavily-Access-Mode"]).toBeUndefined();
  });

  it("returns error when Tavily responds with non-OK status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ detail: "rate limit exceeded" }, { status: 429 }),
      ),
    );

    const raw = await runDeepResearch({ query: "transformer architecture" });
    const result = JSON.parse(raw) as { status: string; error: string };
    expect(result.status).toBe("error");
    expect(result.error).toContain("rate limit");
  });

  it("caps max_results at 10", () => {
    expect(normalizeMaxResults(undefined)).toBe(5);
    expect(normalizeMaxResults(3)).toBe(3);
    expect(normalizeMaxResults(99)).toBe(10);
  });
});

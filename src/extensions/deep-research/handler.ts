import type { DeepResearchInput, DeepResearchResult } from "./types.js";

/** Placeholder — replace with real network search when implementing deep_research. */
export async function runDeepResearch(input: DeepResearchInput): Promise<string> {
  const query = String(input.query ?? "").trim();
  if (!query) {
    return JSON.stringify({
      status: "error",
      error: "query is required",
    } satisfies DeepResearchResult);
  }

  const maxResults =
    input.max_results !== undefined && Number.isFinite(Number(input.max_results))
      ? Math.max(1, Number(input.max_results))
      : undefined;

  return JSON.stringify({
    status: "not_implemented",
    query,
    message:
      "deep_research is registered but not implemented yet. Add fetch logic in extensions/deep-research/handler.ts.",
    ...(maxResults !== undefined ? { max_results: maxResults } : {}),
  } satisfies DeepResearchResult);
}

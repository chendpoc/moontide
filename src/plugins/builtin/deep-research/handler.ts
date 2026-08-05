import { toMessage } from "../../../errors/normalize.js";
import { tavilySearch } from "./tavily.js";
import type { DeepResearchInput, DeepResearchResult } from "./types.js";

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
      ? Number(input.max_results)
      : undefined;

  try {
    const results = await tavilySearch(query, { maxResults });
    return JSON.stringify({
      status: "ok",
      query,
      results,
    } satisfies DeepResearchResult);
  } catch (err) {
    const message = toMessage(err);
    return JSON.stringify({
      status: "error",
      query,
      error: message,
    } satisfies DeepResearchResult);
  }
}

import { tavilyApiKey } from "../../config.js";
import type { DeepResearchResultItem } from "./types.js";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS_CAP = 10;

export interface TavilySearchOptions {
  maxResults?: number;
  apiKey?: string;
}

interface TavilyApiResult {
  title?: string;
  url?: string;
  content?: string;
}

interface TavilyApiResponse {
  results?: TavilyApiResult[];
  detail?: string;
  error?: string;
}

export function normalizeMaxResults(maxResults?: number): number {
  if (maxResults === undefined || !Number.isFinite(maxResults)) {
    return DEFAULT_MAX_RESULTS;
  }
  return Math.min(MAX_RESULTS_CAP, Math.max(1, Math.floor(maxResults)));
}

export async function tavilySearch(
  query: string,
  options: TavilySearchOptions = {},
): Promise<DeepResearchResultItem[]> {
  const maxResults = normalizeMaxResults(options.maxResults);
  const apiKey = options.apiKey ?? tavilyApiKey();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  } else {
    headers["X-Tavily-Access-Mode"] = "keyless";
  }

  const response = await fetch(TAVILY_SEARCH_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query,
      max_results: maxResults,
      search_depth: "basic",
    }),
  });

  const body = (await response.json()) as TavilyApiResponse;

  if (!response.ok) {
    const message =
      body.detail ?? body.error ?? `Tavily search failed (${response.status})`;
    throw new Error(message);
  }

  return (body.results ?? []).map((item) => ({
    title: String(item.title ?? ""),
    url: String(item.url ?? ""),
    snippet: String(item.content ?? ""),
    source: "tavily" as const,
  }));
}

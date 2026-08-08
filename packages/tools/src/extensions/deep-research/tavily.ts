import { infraError } from "@moontide/shared/errors/factories.js";
import { getToolsProductConfig } from "../../ports/product-config.js";
import {
  TAVILY_DEFAULT_MAX_RESULTS,
  TAVILY_MAX_RESULTS_CAP,
  TAVILY_SEARCH_URL,
} from "@moontide/shared/constants/integrations.js";
import { clampInt } from "@moontide/shared/utils/number.js";
import type { DeepResearchResultItem } from "./types.js";

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
    return TAVILY_DEFAULT_MAX_RESULTS;
  }
  return clampInt(maxResults, 1, TAVILY_MAX_RESULTS_CAP);
}

export async function tavilySearch(
  query: string,
  options: TavilySearchOptions = {},
): Promise<DeepResearchResultItem[]> {
  const maxResults = normalizeMaxResults(options.maxResults);
  const apiKey = options.apiKey ?? getToolsProductConfig().tavilyApiKey();

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
    throw infraError(message, { context: { url: TAVILY_SEARCH_URL, status: response.status } });
  }

  return (body.results ?? []).map((item) => ({
    title: String(item.title ?? ""),
    url: String(item.url ?? ""),
    snippet: String(item.content ?? ""),
    source: "tavily" as const,
  }));
}

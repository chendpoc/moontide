export interface DeepResearchInput {
  query: string;
  max_results?: number;
}

export interface DeepResearchResultItem {
  title: string;
  url: string;
  snippet: string;
  source?: "tavily";
}

export interface DeepResearchResult {
  status: "ok" | "error";
  query?: string;
  error?: string;
  results?: DeepResearchResultItem[];
}

export interface DeepResearchInput {
  query: string;
  max_results?: number;
}

export interface DeepResearchResult {
  status: "not_implemented" | "ok" | "error";
  query?: string;
  message?: string;
  error?: string;
  results?: Array<{ title: string; url: string; snippet: string }>;
}

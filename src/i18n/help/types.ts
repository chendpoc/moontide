export type HelpCategoryKey = "general" | "session" | "context" | "observability";

export type HelpStrings = {
  title: string;
  legend: string;
  languageHint: (lang: string) => string;
  categories: Record<HelpCategoryKey, string>;
  summaries: Record<string, string>;
};

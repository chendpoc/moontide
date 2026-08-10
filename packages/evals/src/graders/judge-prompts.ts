import type { EvalCaseCategory } from "../types.js";

const SCORE_SCALE = [
  "Score 1 = Response B (candidate) is clearly worse than A (baseline).",
  "Score 2 = B is somewhat worse.",
  "Score 3 = B and A are roughly equivalent in quality.",
  "Score 4 = B is somewhat better.",
  "Score 5 = B is clearly better.",
].join("\n");

const OUTPUT_SCHEMA = [
  "Respond with JSON only:",
  '{"caseId":"...","score":1-5,"winner":"baseline"|"candidate"|"tie","rationale":"...",',
  '"baselineGood":["..."],"baselineBad":["..."],"candidateGood":["..."],"candidateBad":["..."]}',
  "Arrays may be empty. winner must match score (3=tie unless one side failed the task entirely).",
].join("\n");

const CATEGORY_FOCUS: Record<EvalCaseCategory, string> = {
  coding:
    "Focus on correctness, whether the answer matches the task, evidence from code/files, and concision.",
  exploration:
    "Focus on whether the agent found the right location, used sensible search/read steps in the reply, and answered the navigation question.",
  deep_task:
    "Focus on structure, completion of the deep-task goal, clear decisions or next steps, and use of investigation notes when relevant.",
  general:
    "Focus on factual accuracy, clarity, and avoiding unnecessary tool use or verbosity.",
  regression:
    "Guard metric: B must not be worse than A on simple tasks. Score 3+ if equivalent; score <=2 only if B clearly regressed.",
  external_research:
    "Focus on correct use of http_fetch, answers grounded in fetched JSON/HTML, citation discipline, and not inventing data beyond tool results.",
};

export function subjectiveJudgeSystem(category: EvalCaseCategory): string {
  return [
    "You are an evaluation judge for an agent harness A/B test.",
    "Compare Response A (baseline, feature OFF) vs Response B (candidate, feature ON) for the same task.",
    CATEGORY_FOCUS[category],
    SCORE_SCALE,
    OUTPUT_SCHEMA,
  ].join("\n\n");
}

export function objectiveFallbackSystem(): string {
  return [
    "You are an evaluation judge for an agent harness A/B test.",
    "Objective checks could not separate A and B. Use the checklist to compare responses.",
    "Response A = baseline (feature OFF). Response B = candidate (feature ON).",
    SCORE_SCALE,
    OUTPUT_SCHEMA,
  ].join("\n\n");
}

export function batchJudgeSystem(category: EvalCaseCategory, gradingMode: "subjective" | "objective"): string {
  const base =
    gradingMode === "subjective" ? subjectiveJudgeSystem(category) : objectiveFallbackSystem();
  return [
    base,
    "",
    "You will receive multiple cases. Return JSON:",
    '{"verdicts":[{"caseId":"...","score":1-5,"winner":"baseline"|"candidate"|"tie","rationale":"...",',
    '"baselineGood":[],"baselineBad":[],"candidateGood":[],"candidateBad":[]}]}',
    "verdicts length must match input cases; preserve caseId and order.",
  ].join("\n");
}

import { getLLMProvider, resolveRoute } from "@moontide/llm";

import { withRetry, isRateLimitError } from "../retry.js";
import type { EvalCaseDefinition, EvalRunOutput, RubricJudgeOutcome } from "../types.js";

function _parseRubricVerdict(raw: unknown): RubricJudgeOutcome {
  if (typeof raw !== "object" || raw === null) {
    return {
      score: 0,
      pass: false,
      rationale: "Invalid rubric judge JSON",
      missedBullets: [],
    };
  }
  const parsed = raw as Record<string, unknown>;
  const score = typeof parsed.score === "number" ? parsed.score : 0;
  const missedBullets = Array.isArray(parsed.missedBullets)
    ? parsed.missedBullets.filter((item): item is string => typeof item === "string")
    : [];
  return {
    score,
    pass: score >= 0.7,
    rationale: typeof parsed.rationale === "string" ? parsed.rationale : "No rationale",
    missedBullets,
  };
}

/** LLM rubric grader for subjective cases with rubricBullets. */
export async function gradeWithRubric(
  output: EvalRunOutput,
  caseDef: EvalCaseDefinition,
  judgeModel?: string,
): Promise<RubricJudgeOutcome | undefined> {
  const bullets = caseDef.rubricBullets;
  if (!bullets?.length || caseDef.gradingMode !== "subjective") {
    return undefined;
  }

  const route = resolveRoute(judgeModel ?? caseDef.judgeModel);
  const system = [
    "You grade an agent response against rubric bullets.",
    "Return JSON: { score: 0-1, rationale: string, missedBullets: string[] }",
    "score=1 means all bullets satisfied; deduct proportionally for misses.",
  ].join("\n");

  const user = [
    `Task bullets:\n${bullets.map((b) => `- ${b}`).join("\n")}`,
    `Response:\n${output.reply}`,
  ].join("\n\n");

  const response = await withRetry(
    () =>
      getLLMProvider(route).chat({
        model: route.logicalModelId,
        system,
        messages: [{ role: "user", content: user }],
        tools: [],
        maxTokens: 1024,
        responseFormat: "json_object",
      }),
    { isRetryable: isRateLimitError },
  );

  const text = response.content
    .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      score: 0,
      pass: false,
      rationale: "Rubric judge returned no JSON",
      missedBullets: bullets,
    };
  }

  try {
    return _parseRubricVerdict(JSON.parse(jsonMatch[0]) as unknown);
  } catch {
    return {
      score: 0,
      pass: false,
      rationale: "Failed to parse rubric judge JSON",
      missedBullets: bullets,
    };
  }
}

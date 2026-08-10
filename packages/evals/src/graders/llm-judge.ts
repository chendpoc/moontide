import { getLLMProvider, resolveRoute } from "@moontide/llm";

import { isRateLimitError, withRetry } from "../retry.js";

import type {
  EvalCaseDefinition,
  PairGradeItem,
  PairwiseJudgeVerdict,
  PairwiseScore,
  PairwiseWinner,
} from "../types.js";
import {
  batchJudgeSystem,
  objectiveFallbackSystem,
  subjectiveJudgeSystem,
} from "./judge-prompts.js";

const DEFAULT_BATCH_SIZE = 8;
const MAX_REPLY_CHARS = 8_000;

export interface LlmJudgeOptions {
  judgeModel?: string;
  batchSize?: number;
}

function _clampScore(value: number): PairwiseScore {
  const n = Math.round(value);
  if (n <= 1) {
    return 1;
  }
  if (n >= 5) {
    return 5;
  }
  return n as PairwiseScore;
}

function _parseWinner(value: unknown): PairwiseWinner {
  if (value === "baseline" || value === "candidate" || value === "tie") {
    return value;
  }
  return "tie";
}

function _stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === "string");
}

export function parsePairwiseVerdict(raw: unknown, caseId?: string): PairwiseJudgeVerdict {
  if (typeof raw !== "object" || raw === null) {
    return {
      score: 1,
      winner: "tie",
      rationale: caseId ? `Invalid verdict for ${caseId}` : "Invalid verdict JSON",
    };
  }

  const parsed = raw as Record<string, unknown>;
  const score = typeof parsed.score === "number" ? _clampScore(parsed.score) : 1;
  return {
    score,
    winner: _parseWinner(parsed.winner),
    rationale:
      typeof parsed.rationale === "string" ? parsed.rationale : "No rationale provided",
    baselineGood: _stringArray(parsed.baselineGood),
    baselineBad: _stringArray(parsed.baselineBad),
    candidateGood: _stringArray(parsed.candidateGood),
    candidateBad: _stringArray(parsed.candidateBad),
  };
}

export function parsePairwiseVerdictText(text: string, caseId?: string): PairwiseJudgeVerdict {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      score: 1,
      winner: "tie",
      rationale: "Judge returned no JSON verdict",
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "verdicts" in parsed &&
      Array.isArray((parsed as { verdicts: unknown }).verdicts)
    ) {
      const first = (parsed as { verdicts: unknown[] }).verdicts[0];
      return parsePairwiseVerdict(first, caseId);
    }
    return parsePairwiseVerdict(parsed, caseId);
  } catch {
    return {
      score: 1,
      winner: "tie",
      rationale: "Failed to parse judge JSON",
    };
  }
}

export function parseBatchVerdictsText(
  text: string,
  caseIds: string[],
): Map<string, PairwiseJudgeVerdict> {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  const result = new Map<string, PairwiseJudgeVerdict>();

  if (!jsonMatch) {
    for (const caseId of caseIds) {
      result.set(caseId, parsePairwiseVerdictText("", caseId));
    }
    return result;
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as { verdicts?: unknown[] };
    const verdicts = Array.isArray(parsed.verdicts) ? parsed.verdicts : [];

    for (let i = 0; i < caseIds.length; i += 1) {
      const caseId = caseIds[i]!;
      const raw = verdicts[i];
      if (raw !== undefined) {
        const item =
          typeof raw === "object" && raw !== null && "caseId" in raw
            ? raw
            : { ...(raw as object), caseId };
        result.set(caseId, parsePairwiseVerdict(item, caseId));
      } else {
        result.set(caseId, {
          score: 1,
          winner: "tie",
          rationale: "Missing verdict in batch response",
        });
      }
    }
  } catch {
    for (const caseId of caseIds) {
      result.set(caseId, {
        score: 1,
        winner: "tie",
        rationale: "Failed to parse batch judge JSON",
      });
    }
  }

  return result;
}

function _taskPrompt(caseDef: EvalCaseDefinition): string {
  return caseDef.steps
    .filter((step): step is Extract<typeof step, { type: "prompt" }> => step.type === "prompt")
    .map((step) => step.content)
    .join("\n---\n");
}

function _truncateReply(reply: string): string {
  if (reply.length <= MAX_REPLY_CHARS) {
    return reply;
  }
  return `${reply.slice(0, MAX_REPLY_CHARS)}\n...[truncated]`;
}

function _formatPairBlock(
  item: PairGradeItem,
  includeChecks: boolean,
): string {
  const lines = [
    `### caseId: ${item.caseId}::${item.baseline.repetition}`,
    `Task:\n${_taskPrompt(item.caseDef)}`,
    `Response A (baseline):\n${_truncateReply(item.baseline.reply)}`,
    `Response B (candidate):\n${_truncateReply(item.candidate.reply)}`,
  ];
  if (includeChecks && item.caseDef.expectedChecks?.length) {
    lines.push(
      `Checklist:\n${item.caseDef.expectedChecks.map((c) => `- ${c.kind}: ${JSON.stringify(c)}`).join("\n")}`,
    );
  }
  return lines.join("\n\n");
}

async function _chatJudge(system: string, user: string, judgeModel?: string): Promise<string> {
  const route = resolveRoute(judgeModel);
  const response = await withRetry(
    () =>
      getLLMProvider(route).chat({
        model: route.logicalModelId,
        system,
        messages: [{ role: "user", content: user }],
        tools: [],
        maxTokens: 4096,
        responseFormat: "json_object",
      }),
    { isRetryable: isRateLimitError },
  );

  return response.content
    .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/** Single pair LLM judge (subjective or objective fallback). */
export async function gradePairWithLlm(
  item: PairGradeItem,
  mode: "subjective" | "objective",
  options: LlmJudgeOptions = {},
): Promise<{ verdict: PairwiseJudgeVerdict; judgeModel: string; rawText: string }> {
  const route = resolveRoute(options.judgeModel ?? item.caseDef.judgeModel);
  const judgeModel = route.logicalModelId;
  const system =
    mode === "subjective"
      ? subjectiveJudgeSystem(item.caseDef.category)
      : objectiveFallbackSystem();

  const user = _formatPairBlock(item, mode === "objective");
  const rawText = await _chatJudge(system, user, options.judgeModel ?? item.caseDef.judgeModel);
  const parsed = parsePairwiseVerdictText(rawText, item.caseId);
  return { verdict: parsed, judgeModel, rawText };
}

/** Batch LLM judge; on parse failure caller should retry singles. */
export async function gradePairBatchWithLlm(
  items: PairGradeItem[],
  mode: "subjective" | "objective",
  options: LlmJudgeOptions = {},
): Promise<{ verdicts: Map<string, PairwiseJudgeVerdict>; judgeModel: string; rawText: string }> {
  if (items.length === 0) {
    return { verdicts: new Map(), judgeModel: "", rawText: "" };
  }

  const category = items[0]!.caseDef.category;
  const judgeModelRef = options.judgeModel ?? items[0]!.caseDef.judgeModel;
  const route = resolveRoute(judgeModelRef);
  const judgeModel = route.logicalModelId;
  const system = batchJudgeSystem(category, mode);
  const user = items
    .map((item) => _formatPairBlock(item, mode === "objective"))
    .join("\n\n---\n\n");

  const rawText = await _chatJudge(system, user, judgeModelRef);
  const caseIds = items.map((item) => `${item.caseId}::${item.baseline.repetition}`);
  const verdicts = parseBatchVerdictsText(rawText, caseIds);
  return { verdicts, judgeModel, rawText };
}

export function chunkPairItems(items: PairGradeItem[], batchSize = DEFAULT_BATCH_SIZE): PairGradeItem[][] {
  const size = Math.max(1, batchSize);
  const chunks: PairGradeItem[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export function isBatchParseFailure(
  verdicts: Map<string, PairwiseJudgeVerdict>,
  caseIds: string[],
): boolean {
  return caseIds.some((id) => {
    const v = verdicts.get(id);
    return (
      v?.rationale === "Failed to parse batch judge JSON" ||
      v?.rationale === "Judge returned no JSON verdict" ||
      v?.rationale === "Missing verdict in batch response"
    );
  });
}

/** @deprecated Use parsePairwiseVerdictText */
export function parseLlmJudgeVerdict(text: string): {
  score: number;
  pass: boolean;
  rationale: string;
} {
  const v = parsePairwiseVerdictText(text);
  return {
    score: v.score / 5,
    pass: v.score >= 4,
    rationale: v.rationale,
  };
}

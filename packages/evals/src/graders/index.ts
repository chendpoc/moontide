import type {
  EvalCaseDefinition,
  EvalRunOutput,
  JudgeOptions,
  PairGradeItem,
  PairwiseJudgeVerdict,
} from "../types.js";
import {
  failedRunVerdict,
  runChecksOnOutput,
  verdictFromObjectiveChecks,
} from "./objective-checks.js";
import {
  chunkPairItems,
  gradePairBatchWithLlm,
  gradePairWithLlm,
  isBatchParseFailure,
  type LlmJudgeOptions,
} from "./llm-judge.js";

export {
  chunkPairItems,
  gradePairBatchWithLlm,
  gradePairWithLlm,
  parseBatchVerdictsText,
  parsePairwiseVerdict,
  parsePairwiseVerdictText,
} from "./llm-judge.js";
export type { LlmJudgeOptions } from "./llm-judge.js";
export {
  filePathsFromChecks,
  runChecksOnOutput,
  verdictFromObjectiveChecks,
} from "./objective-checks.js";
export { batchJudgeSystem, subjectiveJudgeSystem } from "./judge-prompts.js";

export interface GradePairResult {
  verdict: PairwiseJudgeVerdict;
  judgeModel?: string;
  objectiveChecks?: {
    baseline: ReturnType<typeof runChecksOnOutput>;
    candidate: ReturnType<typeof runChecksOnOutput>;
  };
}

/** Grade one baseline/candidate pair (objective checks first, then LLM if needed). */
export async function gradePair(
  baseline: EvalRunOutput,
  candidate: EvalRunOutput,
  caseDef: EvalCaseDefinition,
  options: LlmJudgeOptions = {},
): Promise<GradePairResult> {
  if (baseline.error || candidate.error) {
    return { verdict: failedRunVerdict(baseline, candidate) };
  }

  if (caseDef.gradingMode === "objective") {
    const checks = caseDef.expectedChecks ?? [];
    if (checks.length === 0) {
      throw new Error(`Objective case ${caseDef.id} missing expectedChecks`);
    }

    const baselineChecks = runChecksOnOutput(baseline, checks);
    const candidateChecks = runChecksOnOutput(candidate, checks);
    const derived = verdictFromObjectiveChecks(baselineChecks, candidateChecks);

    if (derived) {
      return {
        verdict: derived,
        objectiveChecks: { baseline: baselineChecks, candidate: candidateChecks },
      };
    }

    const llm = await gradePairWithLlm(
      { caseId: caseDef.id, caseDef, baseline, candidate },
      "objective",
      options,
    );
    return {
      verdict: llm.verdict,
      judgeModel: llm.judgeModel,
      objectiveChecks: { baseline: baselineChecks, candidate: candidateChecks },
    };
  }

  const llm = await gradePairWithLlm(
    { caseId: caseDef.id, caseDef, baseline, candidate },
    "subjective",
    options,
  );
  return { verdict: llm.verdict, judgeModel: llm.judgeModel };
}

/** Grade many pairs in batches; retries failed batches one pair at a time. Returns results in input order. */
export async function gradePairBatch(
  items: PairGradeItem[],
  options: JudgeOptions = {},
): Promise<GradePairResult[]> {
  const results: GradePairResult[] = new Array(items.length);
  const indexByItem = new Map<PairGradeItem, number>();
  items.forEach((item, index) => indexByItem.set(item, index));

  const pendingObjective: PairGradeItem[] = [];
  const pendingSubjective: PairGradeItem[] = [];

  for (const item of items) {
    if (item.baseline.error || item.candidate.error) {
      results[indexByItem.get(item)!] = {
        verdict: failedRunVerdict(item.baseline, item.candidate),
      };
      continue;
    }

    if (item.caseDef.gradingMode === "objective") {
      const checks = item.caseDef.expectedChecks ?? [];
      if (checks.length === 0) {
        throw new Error(`Objective case ${item.caseDef.id} missing expectedChecks`);
      }
      const baselineChecks = runChecksOnOutput(item.baseline, checks);
      const candidateChecks = runChecksOnOutput(item.candidate, checks);
      const derived = verdictFromObjectiveChecks(baselineChecks, candidateChecks);
      if (derived) {
        results[indexByItem.get(item)!] = {
          verdict: derived,
          objectiveChecks: { baseline: baselineChecks, candidate: candidateChecks },
        };
        continue;
      }
      pendingObjective.push(item);
    } else {
      pendingSubjective.push(item);
    }
  }

  const batchSize = options.batchSize ?? 8;
  await _gradePendingBatch(pendingSubjective, "subjective", options, batchSize, results, indexByItem);
  await _gradePendingBatch(pendingObjective, "objective", options, batchSize, results, indexByItem);

  return results;
}

function _pairKey(item: PairGradeItem): string {
  return `${item.caseId}::${item.baseline.repetition}`;
}

async function _gradePendingBatch(
  items: PairGradeItem[],
  mode: "subjective" | "objective",
  options: JudgeOptions,
  batchSize: number,
  results: GradePairResult[],
  indexByItem: Map<PairGradeItem, number>,
): Promise<void> {
  for (const chunk of chunkPairItems(items, batchSize)) {
    if (chunk.length === 1) {
      const item = chunk[0]!;
      const graded = await gradePair(item.baseline, item.candidate, item.caseDef, options);
      results[indexByItem.get(item)!] = graded;
      continue;
    }

    const batch = await gradePairBatchWithLlm(chunk, mode, options);
    const caseIds = chunk.map((item) => _pairKey(item));
    const failed = isBatchParseFailure(batch.verdicts, caseIds);

    if (failed) {
      for (const item of chunk) {
        const graded = await gradePair(item.baseline, item.candidate, item.caseDef, options);
        results[indexByItem.get(item)!] = graded;
      }
      continue;
    }

    for (const item of chunk) {
      const verdict = batch.verdicts.get(_pairKey(item))!;
      const entry: GradePairResult = { verdict, judgeModel: batch.judgeModel };
      if (mode === "objective" && item.caseDef.expectedChecks) {
        entry.objectiveChecks = {
          baseline: runChecksOnOutput(item.baseline, item.caseDef.expectedChecks),
          candidate: runChecksOnOutput(item.candidate, item.caseDef.expectedChecks),
        };
      }
      results[indexByItem.get(item)!] = entry;
    }
  }
}

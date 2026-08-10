import type {
  EvalRunOutput,
  ExpectedCheck,
  ObjectiveCheckOutcome,
  PairwiseJudgeVerdict,
  PairwiseScore,
} from "../types.js";

export function runChecksOnOutput(
  output: EvalRunOutput,
  checks: ExpectedCheck[],
): ObjectiveCheckOutcome {
  const details: string[] = [];
  let passCount = 0;

  if (output.error) {
    return {
      passCount: 0,
      totalChecks: checks.length,
      allPass: false,
      details: [`run error: ${output.error}`],
    };
  }

  for (const check of checks) {
    const passed = _runOneCheck(output, check);
    details.push(`${check.kind}: ${passed ? "pass" : "fail"}`);
    if (passed) {
      passCount += 1;
    }
  }

  return {
    passCount,
    totalChecks: checks.length,
    allPass: passCount === checks.length && checks.length > 0,
    details,
  };
}

function _toolNames(output: EvalRunOutput): string[] {
  return output.items
    .filter((item) => item.kind === "tool_invocation")
    .map((item) => item.name);
}

function _replyMatchesPattern(pattern: string, reply: string): boolean {
  const normalized = pattern.replace(/^\(\?i\)/i, "");
  return new RegExp(normalized, "i").test(reply);
}

function _runOneCheck(output: EvalRunOutput, check: ExpectedCheck): boolean {
  switch (check.kind) {
    case "reply_contains":
      return output.reply.toLowerCase().includes(check.value.toLowerCase());
    case "reply_matches":
      return _replyMatchesPattern(check.pattern, output.reply);
    case "file_contains": {
      const content = output.files?.[check.path];
      if (content === undefined) {
        return false;
      }
      return content.includes(check.value);
    }
    case "tool_min_count":
      return output.toolCallCount >= check.min;
    case "tool_called": {
      const needle = check.name.toLowerCase();
      return _toolNames(output).some((name) => name.toLowerCase() === needle);
    }
    case "work_mem_used":
      return Boolean(output.workMemId) || (output.workMemEvents?.length ?? 0) > 0;
    default:
      return false;
  }
}

export function filePathsFromChecks(checks: ExpectedCheck[]): string[] {
  const paths = new Set<string>();
  for (const check of checks) {
    if (check.kind === "file_contains") {
      paths.add(check.path);
    }
  }
  return [...paths];
}

/** Derive pairwise verdict from objective check counts when LLM is not needed. */
export function verdictFromObjectiveChecks(
  baseline: ObjectiveCheckOutcome,
  candidate: ObjectiveCheckOutcome,
): PairwiseJudgeVerdict | null {
  if (baseline.totalChecks === 0) {
    return null;
  }

  if (candidate.passCount > baseline.passCount) {
    const score = candidate.allPass ? 5 : 4;
    return {
      score: score as PairwiseScore,
      winner: "candidate",
      rationale: `Candidate passed ${candidate.passCount}/${candidate.totalChecks} checks vs baseline ${baseline.passCount}/${baseline.totalChecks}.`,
      candidateGood: candidate.details.filter((d) => d.endsWith("pass")),
      baselineBad: baseline.details.filter((d) => d.endsWith("fail")),
    };
  }

  if (baseline.passCount > candidate.passCount) {
    const score = baseline.allPass ? 1 : 2;
    return {
      score: score as PairwiseScore,
      winner: "baseline",
      rationale: `Baseline passed ${baseline.passCount}/${baseline.totalChecks} vs candidate ${candidate.passCount}/${candidate.totalChecks}.`,
      baselineGood: baseline.details.filter((d) => d.endsWith("pass")),
      candidateBad: candidate.details.filter((d) => d.endsWith("fail")),
    };
  }

  if (baseline.allPass && candidate.allPass) {
    return {
      score: 3,
      winner: "tie",
      rationale: `Both passed all ${baseline.totalChecks} objective checks.`,
    };
  }

  if (baseline.passCount === candidate.passCount) {
    return {
      score: 3,
      winner: "tie",
      rationale: `Both passed ${baseline.passCount}/${baseline.totalChecks} checks (same count, partial pass).`,
    };
  }

  return null;
}

export function failedRunVerdict(
  baseline: EvalRunOutput,
  candidate: EvalRunOutput,
): PairwiseJudgeVerdict {
  if (baseline.error && candidate.error) {
    return {
      score: 3,
      winner: "tie",
      rationale: "Both runs failed before grading.",
    };
  }
  if (candidate.error) {
    return {
      score: 1,
      winner: "baseline",
      rationale: `Candidate run failed: ${candidate.error}`,
    };
  }
  return {
    score: 5,
    winner: "candidate",
    rationale: `Baseline run failed: ${baseline.error}`,
  };
}

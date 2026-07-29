import { contextVerbose } from "../config.js";
import { formatContext } from "./format.js";
import type { ContextReport } from "./types.js";

export function printPreLlmVerbose(report: ContextReport): void {
  const level = contextVerbose();
  if (level <= 0) {
    return;
  }

  console.error(`[context:pre] ${formatContext(report, "summary").replace(/\n/g, " | ")}`);
  if (level >= 2) {
    console.error(formatContext(report, "struct"));
  }
}

export function printPostLlmVerbose(report: ContextReport): void {
  const level = contextVerbose();
  if (level <= 0) {
    return;
  }

  const usage = report.usage;
  if (!usage?.inputTokens) {
    return;
  }

  console.error(
    `[context:post] turn ${report.turn} usage: in=${usage.inputTokens} out=${usage.outputTokens ?? 0}`,
  );
}

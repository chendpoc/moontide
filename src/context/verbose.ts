import { contextVerbose, contextVerboseDetail } from "../config.js";
import type { ContextReport } from "./types.js";
import { renderPostLlmVerbose, renderPreLlmVerbose } from "./terminal.js";

export function printPreLlmVerbose(report: ContextReport): void {
  const level = contextVerbose();
  if (level <= 0) {
    return;
  }

  for (const line of renderPreLlmVerbose(report, level as 1 | 2, contextVerboseDetail())) {
    console.error(line);
  }
}

export function printPostLlmVerbose(report: ContextReport): void {
  const level = contextVerbose();
  if (level <= 0) {
    return;
  }

  const lines = renderPostLlmVerbose(report);
  if (!lines) {
    return;
  }

  console.error("");
  for (const line of lines) {
    console.error(line);
  }
}

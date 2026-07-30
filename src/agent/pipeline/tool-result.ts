import type { ToolUseOutcome, ToolUseRecord } from "./types.js";

const TOOL_ERROR_PREFIX = "Error: ";

/** Map legacy handler error strings to failed outcomes. */
export function outcomeFromToolOutput(output: string): ToolUseOutcome {
  if (output.startsWith(TOOL_ERROR_PREFIX)) {
    return { status: "failed", error: output.slice(TOOL_ERROR_PREFIX.length) };
  }
  return { status: "succeeded", output };
}

export function toolResultContent(outcome: ToolUseOutcome): string {
  switch (outcome.status) {
    case "succeeded":
      return outcome.output;
    case "denied":
    case "rejected":
      return outcome.reason;
    case "failed":
      return outcome.error;
  }
}

/** Read-only snapshot for plugin hooks — structuredClone + shallow freeze, no extra deps. */
export function freezeToolUseRecord(record: ToolUseRecord): ToolUseRecord {
  const snapshot = structuredClone(record);
  Object.freeze(snapshot.outcome);
  Object.freeze(snapshot.toolInput);
  return Object.freeze(snapshot);
}

export function appendModelToolResult(base: string, appends: string[]): string {
  const extras = appends.map((part) => part.trim()).filter(Boolean);
  if (extras.length === 0) {
    return base;
  }
  return [base, ...extras].join("\n\n");
}

export function buildModelToolResult(outcome: ToolUseOutcome, appends: string[]): string {
  return appendModelToolResult(toolResultContent(outcome), appends);
}

import type { EvalRunOutput, ProtocolCheckOutcome } from "../types.js";

function _toolNames(output: EvalRunOutput): string[] {
  return output.items
    .filter((item) => item.kind === "tool_invocation")
    .map((item) => item.name);
}

function _firstNonWorkMemToolIndex(output: EvalRunOutput): number | undefined {
  const index = output.items.findIndex(
    (item) =>
      item.kind === "tool_invocation" &&
      item.name !== "work_mem" &&
      item.name !== "workmem",
  );
  return index >= 0 ? index : undefined;
}

function _firstOutlineIndex(output: EvalRunOutput): number | undefined {
  const workMemToolIndex = output.items.findIndex(
    (item) => item.kind === "tool_invocation" && item.name === "work_mem",
  );
  return workMemToolIndex >= 0 ? workMemToolIndex : undefined;
}

function _hasDecisionDraft(output: EvalRunOutput): boolean {
  return Boolean(
    output.workMemEvents?.some(
      (event) => event.kind === "workmem_draft" && event.draftKind === "decision",
    ),
  );
}

function _synthesizeReminderFired(output: EvalRunOutput): boolean {
  const haystack = output.items
    .filter((item) => item.kind === "assistant_message" || item.kind === "tool_invocation")
    .map((item) => JSON.stringify(item).toLowerCase())
    .join("\n");
  return haystack.includes("synthesize") && haystack.includes("reminder");
}

/** Deterministic deep-protocol guard metrics from session output. */
export function runProtocolChecks(output: EvalRunOutput): ProtocolCheckOutcome {
  const workMemUsed =
    Boolean(output.workMemId) || (output.workMemEvents?.length ?? 0) > 0;
  const outlineIndex = _firstOutlineIndex(output);
  const firstToolIndex = _firstNonWorkMemToolIndex(output);
  const outlineBeforeTools =
    outlineIndex !== undefined &&
    (firstToolIndex === undefined || outlineIndex <= firstToolIndex);
  const decisionRecorded = _hasDecisionDraft(output);
  const synthesizeReminderFired = _synthesizeReminderFired(output);

  const details = [
    `workMemUsed: ${workMemUsed ? "pass" : "fail"}`,
    `outlineBeforeTools: ${outlineBeforeTools ? "pass" : "fail"}`,
    `decisionRecorded: ${decisionRecorded ? "pass" : "fail"}`,
    `synthesizeReminderFired: ${synthesizeReminderFired ? "fail" : "pass"}`,
    `tools: ${_toolNames(output).join(", ") || "none"}`,
  ];

  return {
    workMemUsed,
    outlineBeforeTools,
    decisionRecorded,
    synthesizeReminderFired,
    details,
  };
}

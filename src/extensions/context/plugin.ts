import { buildContextReport, withUsage } from "../../context/analyze.js";
import { buildSnapshot } from "../../context/snapshot.js";
import {
  getPreviousEstimated,
  updateLatestReport,
  updateSessionFromSnapshot,
} from "../../context/sessions.js";
import type { ContextReport } from "../../context/types.js";
import type { EventDraft } from "../../events/types.js";
import { registerSlot } from "../../events/orchestrator.js";

function reportPayload(report: ContextReport): Record<string, unknown> {
  return { report: structuredClone(report) as unknown as Record<string, unknown> };
}

function handlePreLlmContext(ctx: Record<string, unknown>): EventDraft[] {
  const snapshot = buildSnapshot(ctx);
  const report = buildContextReport(snapshot, getPreviousEstimated());
  updateSessionFromSnapshot(snapshot, report);

  return [
    {
      turn: snapshot.turn,
      phase: "pre_llm",
      channel: "context",
      kind: "metrics_pre",
      payload: reportPayload(report),
      preview: `est ${report.estimatedTokens}/${report.limit}`,
    },
  ];
}

function handlePostLlmContext(ctx: Record<string, unknown>): EventDraft[] {
  const snapshot = buildSnapshot(ctx);
  let report = buildContextReport(snapshot, getPreviousEstimated());

  const usage = snapshot.response?.usage;
  if (usage) {
    report = withUsage(report, {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
    });
    updateLatestReport(report);
  }

  const inTok = report.usage?.inputTokens ?? report.estimatedTokens;
  const outTok = report.usage?.outputTokens ?? 0;

  return [
    {
      turn: snapshot.turn,
      phase: "post_llm",
      channel: "context",
      kind: "metrics_post",
      payload: reportPayload(report),
      preview: `in=${inTok} out=${outTok}`,
    },
  ];
}

export function registerContextPlugin(): void {
  registerSlot("pre_llm:context", handlePreLlmContext);
  registerSlot("post_llm:context", handlePostLlmContext);
}

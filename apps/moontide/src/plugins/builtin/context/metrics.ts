import { buildContextReport, withUsage } from "../../../context-inspect/analyze.js";
import { buildSnapshot } from "../../../context-inspect/snapshot.js";
import {
  getPreviousEstimated,
  publishContextReport,
  updateLatestReport,
} from "../../../agent/context-status.js";
import type { ContextReport } from "../../../context-inspect/types.js";
import type { LLMCallRecord } from "../../../agent/pipeline/index.js";
import type { EventDraft } from "@moontide/log";

function reportPayload(report: ContextReport): Record<string, unknown> {
  return { report: structuredClone(report) as unknown as Record<string, unknown> };
}

function formatMetricsPreview(report: ContextReport): string {
  const usage = report.usage;
  if (usage?.inputTokens !== undefined) {
    const outTok = usage.outputTokens ?? 0;
    return `in=${usage.inputTokens} out=${outTok}`;
  }
  const kind = report.exactTokens !== undefined ? "exact" : "est";
  const tokens = report.exactTokens ?? report.estimatedTokens;
  return `est ${tokens}/${report.limit} ${kind}`;
}

export function buildContextMetricsDraft(record: LLMCallRecord): EventDraft[] {
  const snapshot = buildSnapshot({
    turn: record.turn,
    messages: record.request.messages,
    system: record.request.system,
    tools: record.request.tools,
    response:
      record.outcome.status === "succeeded" ? record.outcome.response : undefined,
  });

  let report = buildContextReport(snapshot, getPreviousEstimated());
  publishContextReport(report);

  if (record.outcome.status === "succeeded") {
    const usage = record.outcome.response.usage;
    if (usage) {
      report = withUsage(report, {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      });
      updateLatestReport(report);
    }
  }

  return [
    {
      turn: record.turn,
      phase: "post_llm",
      channel: "context",
      kind: "context_metrics",
      payload: reportPayload(report),
      preview: formatMetricsPreview(report),
    },
  ];
}

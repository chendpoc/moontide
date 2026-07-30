import { buildContextReport, withUsage } from "../../context/analyze.js";
import { buildSnapshot } from "../../context/snapshot.js";
import {
  getPreviousEstimated,
  updateLatestReport,
  updateSessionFromSnapshot,
} from "../../context/sessions.js";
import type { ContextReport } from "../../context/types.js";
import type { AgentPlugin, LLMCallRecord } from "../../agent/pipeline/types.js";
import type { EventDraft } from "../../events/types.js";

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

function buildContextMetricsDraft(record: LLMCallRecord): EventDraft[] {
  const snapshot = buildSnapshot({
    turn: record.turn,
    messages: record.request.messages,
    system: record.request.system,
    tools: record.request.tools,
    response:
      record.outcome.status === "succeeded" ? record.outcome.response : undefined,
  });

  let report = buildContextReport(snapshot, getPreviousEstimated());
  updateSessionFromSnapshot(snapshot, report);

  if (record.outcome.status === "succeeded") {
    const usage = record.outcome.response.usage;
    if (usage) {
      report = withUsage(report, {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
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

export function contextPlugin(): AgentPlugin {
  return {
    name: "context",
    onLLMCall(record) {
      return buildContextMetricsDraft(record);
    },
  };
}

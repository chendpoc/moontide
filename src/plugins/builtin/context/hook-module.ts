import { buildContextMetricsDraft } from "../context/metrics.js";
import type { LLMCallRecord } from "../../../agent/pipeline/types.js";

export function handleLlmCallMetrics(record: LLMCallRecord) {
  return buildContextMetricsDraft(record);
}

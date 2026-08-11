import { buildContextMetricsDraft } from "./metrics.js";
import type { LLMCallRecord } from "../../../agent/pipeline/index.js";

export function handleLlmCallMetrics(record: LLMCallRecord) {
  return buildContextMetricsDraft(record);
}

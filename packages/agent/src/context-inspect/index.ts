export type {
  ContextAlert,
  ContextReport,
  ContextSnapshot,
  ContextStructure,
  ContextTrend,
  ContextUsage,
  DetailLevel,
  MessageLine,
  TokenBreakdown,
} from "./types.js";

export { buildContextReport, withExactTokens, withUsage } from "./analyze.js";
export { formatContext, getBreakdown, getFull, getStruct, getSummary } from "./format.js";
export {
  analyzeStructure,
  buildMessageLines,
  estimateBreakdown,
  estimateJsonTokens,
  estimateTextTokens,
  exactTokenCount,
} from "./metrics.js";
export { buildSnapshot } from "./snapshot.js";
export {
  describeDebugMode,
  getDebugLevel,
  isDebugFileEnabled,
  isDebugTerminalEnabled,
  parseDebugLevelArg,
  resetDebugOverride,
  setDebugOverride,
} from "./debug-mode.js";
export type { DebugLevel } from "@moontide/shared/constants/debug.js";
export { emitDebugRecord, type DebugRecord } from "./debug-emit.js";
export { debugLogPath } from "./debug-file.js";
export {
  getLatestReport,
  getLastComposedRequest,
  getPreviousEstimated,
  getRuntimeTurn,
  publishComposeResult,
  publishContextReport,
  resetRuntimeStatus,
  updateLatestReport,
} from "../agent/context-status.js";

import type { DetailLevel } from "./types.js";
import { withExactTokens } from "./analyze.js";
import { formatContext } from "./format.js";
import { exactTokenCount } from "./metrics.js";
import { getLatestReport, getLastComposedRequest } from "../agent/context-status.js";

export async function inspectContext(
  detail: DetailLevel = "summary",
  exact = false,
): Promise<string> {
  const report = getLatestReport();
  if (!report) {
    return "No context report available yet. Run at least one LLM turn first.";
  }

  if (exact) {
    const composed = getLastComposedRequest();
    if (!composed) {
      return "No composed request available yet. Run at least one LLM turn first.";
    }
    const exactTokens = await exactTokenCount(
      composed.messages,
      composed.system,
      composed.tools,
    );
    return formatContext(withExactTokens(report, exactTokens), detail);
  }

  return formatContext(report, detail);
}

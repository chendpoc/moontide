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
export { appendContextLog } from "./log.js";
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
  getLatestReport,
  getPreviousEstimated,
  getSession,
  resetSession,
  updateLatestReport,
  updateSessionFromSnapshot,
} from "./sessions.js";

import type { DetailLevel } from "./types.js";
import { withExactTokens } from "./analyze.js";
import { formatContext } from "./format.js";
import { exactTokenCount } from "./metrics.js";
import { getLatestReport, getSession } from "./sessions.js";

export async function inspectContext(
  detail: DetailLevel = "summary",
  exact = false,
): Promise<string> {
  const report = getLatestReport();
  if (!report) {
    return "No context report available yet. Run at least one LLM turn first.";
  }

  if (exact) {
    const session = getSession();
    const exactTokens = await exactTokenCount(session.messages, session.system, session.tools);
    return formatContext(withExactTokens(report, exactTokens), detail);
  }

  return formatContext(report, detail);
}

import { buildContextReport, withUsage } from "./analyze.js";
import { appendContextLog } from "./log.js";
import { buildSnapshot } from "./snapshot.js";
import {
  getPreviousEstimated,
  updateLatestReport,
  updateSessionFromSnapshot,
} from "./sessions.js";
import { printPostLlmVerbose, printPreLlmVerbose } from "./verbose.js";

export function preLlmContextHook(context: Record<string, unknown>): void {
  const snapshot = buildSnapshot(context);
  const report = buildContextReport(snapshot, getPreviousEstimated());
  updateSessionFromSnapshot(snapshot, report);
  printPreLlmVerbose(report);
}

export function postLlmContextHook(context: Record<string, unknown>): void {
  const snapshot = buildSnapshot(context);
  let report = buildContextReport(snapshot, getPreviousEstimated());

  const usage = snapshot.response?.usage;
  if (usage) {
    report = withUsage(report, {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
    });
    updateLatestReport(report);
  }

  appendContextLog(report, snapshot);
  printPostLlmVerbose(report);
}

export function registerContextHooks(register: (event: string, callback: HookFn) => void): void {
  register("PreLLM", preLlmContextHook);
  register("PostLLM", postLlmContextHook);
}

type HookFn = (context: Record<string, unknown>) => string | null | void;

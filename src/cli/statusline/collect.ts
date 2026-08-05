import { getWorkdir, modelId } from "../../config.js";
import { getLatestReport, getRuntimeTurn } from "../../agent/context-status.js";
import { getRunId } from "../../log/run.js";
import { shortenHomePath } from "../../utils/path.js";
import type { StatusLinePayload, StatusSnapshot } from "./types.js";

let replPhase: "idle" | "running" = "idle";

export function setReplPhase(phase: "idle" | "running"): void {
  replPhase = phase;
}

export function getReplPhase(): "idle" | "running" {
  return replPhase;
}

export function collectStatusSnapshot(): StatusSnapshot {
  const workdir = getWorkdir();
  const report = getLatestReport();
  const turn = getRuntimeTurn() || null;
  const dialogueTier = report?.budgetTiers?.find((tier) => tier.tier === "dialogue");

  const contextUsed =
    dialogueTier?.estimatedTokens ??
    (report !== undefined ? (report.exactTokens ?? report.estimatedTokens) : null);
  const contextLimit = dialogueTier?.limitTokens ?? report?.limit ?? null;
  const contextPct = report?.dialoguePercentUsed ?? report?.percentUsed ?? null;
  const contextDelta = report?.trend.hasBaseline ? report.trend.deltaTokens : null;
  const contextHasBaseline = report?.trend.hasBaseline ?? false;

  return {
    phase: replPhase,
    model: modelId(),
    workdir: shortenHomePath(workdir),
    runId: getRunId(),
    turn,
    contextPct,
    contextUsed,
    contextLimit,
    contextDelta,
    contextHasBaseline,
    lastApiIn: report?.usage?.inputTokens ?? null,
    lastApiOut: report?.usage?.outputTokens ?? null,
  };
}

export function snapshotToPayload(snapshot: StatusSnapshot, cwd = getWorkdir()): StatusLinePayload {
  return {
    session_id: snapshot.runId,
    cwd,
    model: {
      id: snapshot.model,
      display_name: snapshot.model,
    },
    context_window: {
      used_tokens: snapshot.contextUsed,
      context_window_size: snapshot.contextLimit,
      used_percentage: snapshot.contextPct,
      delta_tokens: snapshot.contextDelta,
      has_baseline: snapshot.contextHasBaseline,
    },
    usage: {
      input_tokens: snapshot.lastApiIn,
      output_tokens: snapshot.lastApiOut,
    },
    turn: snapshot.turn,
    phase: snapshot.phase,
    run_id: snapshot.runId,
  };
}

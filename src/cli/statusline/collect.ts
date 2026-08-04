import { getWorkdir, modelId } from "../../config.js";
import { getLatestReport, getRuntimeTurn } from "../../context/runtime-status.js";
import { getRunId } from "../../log/run.js";
import { shortenHomePath } from "../../utils/path.js";
import type { StatusSnapshot } from "./types.js";

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
  const contextPct = report?.percentUsed ?? null;

  return {
    phase: replPhase,
    model: modelId(),
    workdir: shortenHomePath(workdir),
    runId: getRunId(),
    turn,
    contextPct,
  };
}

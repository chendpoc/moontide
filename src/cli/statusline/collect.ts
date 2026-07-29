import { getWorkdir, modelId } from "../../config.js";
import { getLatestReport, getSession } from "../../context/sessions.js";
import {
  isEventsMode,
  shouldShowContextCli,
  shouldShowEventsCli,
  shouldShowTraceCli,
} from "../../events/cli-session.js";
import type { StatusSnapshot } from "./types.js";

let replPhase: "idle" | "running" = "idle";

export function setReplPhase(phase: "idle" | "running"): void {
  replPhase = phase;
}

export function getReplPhase(): "idle" | "running" {
  return replPhase;
}

function shortWorkdir(workdir: string): string {
  const home = process.env.HOME;
  if (home && workdir.startsWith(home)) {
    return `~${workdir.slice(home.length)}`;
  }
  return workdir;
}

export function collectStatusSnapshot(): StatusSnapshot {
  const workdir = getWorkdir();
  const report = getLatestReport();
  const turn = getSession().turn || null;
  const contextPct = report?.percentUsed ?? null;

  const contextDetail =
    contextPct !== null ? `${contextPct.toFixed(1)}%` : undefined;

  return {
    phase: replPhase,
    model: modelId(),
    workdir: shortWorkdir(workdir),
    turn,
    contextPct,
    context: {
      enabled: shouldShowContextCli(),
      detail: contextDetail,
    },
    trace: { enabled: shouldShowTraceCli() },
    eventsStream: { enabled: isEventsMode() },
    eventsDisplay: { enabled: shouldShowEventsCli() },
  };
}

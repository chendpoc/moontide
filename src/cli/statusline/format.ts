import chalk from "chalk";

import type { StatusSnapshot } from "./types.js";

const themes = {
  dim: chalk.gray,
  phase: chalk.green,
  phaseRunning: chalk.yellow,
  context: chalk.cyan,
};

function formatContext(snapshot: StatusSnapshot): string {
  const label = themes.context("context");
  if (snapshot.contextPct !== null) {
    return `${label} ${themes.context(`${snapshot.contextPct.toFixed(1)}%`)}`;
  }
  return `${label} ${themes.dim("—")}`;
}

function formatTurn(snapshot: StatusSnapshot): string {
  const label = themes.dim("turn");
  if (snapshot.turn === null) {
    return `${label} ${themes.dim("—")}`;
  }
  return `${label} ${themes.dim(String(snapshot.turn))}`;
}

/** Default single-line REPL status bar (compact but readable). */
export function formatStatusLine(snapshot: StatusSnapshot): string {
  const phasePaint =
    snapshot.phase === "running" ? themes.phaseRunning("running") : themes.phase("idle");

  const channels = [formatContext(snapshot), formatTurn(snapshot)].join(themes.dim(" · "));

  return [chalk.bold("Oculeau"), phasePaint, channels].join(themes.dim(" · "));
}

/** Full status for /status. */
export function formatStatusLineVerbose(snapshot: StatusSnapshot): string {
  const phasePaint =
    snapshot.phase === "running" ? themes.phaseRunning("running") : themes.phase("idle");

  const contextDetail =
    snapshot.contextPct !== null ? `${snapshot.contextPct.toFixed(1)}%` : "—";

  return [
    chalk.bold("Oculeau"),
    themes.dim(snapshot.model),
    themes.dim(snapshot.workdir),
    phasePaint,
    themes.context(`context ${contextDetail}`),
    themes.dim(snapshot.turn !== null ? `turn ${snapshot.turn}` : "turn —"),
  ].join(themes.dim(" · "));
}

/** Legend text for /help. */
export function formatStatusLineLegend(): string {
  return "Statusline: context usage % · turn N (events → .oculeau/events.jsonl)";
}

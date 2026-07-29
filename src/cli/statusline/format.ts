import chalk from "chalk";

import type { ChannelStatus, StatusSnapshot } from "./types.js";

const themes = {
  context: chalk.cyan,
  trace: chalk.yellow,
  events: chalk.magenta,
  dim: chalk.gray,
  label: chalk.white,
  phase: chalk.green,
  phaseRunning: chalk.yellow,
};

function formatCompactPill(
  label: string,
  enabled: boolean,
  color: typeof themes.context,
): string {
  const mark = enabled ? color("●") : themes.dim("○");
  return `${color(label)}${mark}`;
}

function formatCtxPill(channel: ChannelStatus): string {
  const pill = formatCompactPill("ctx", channel.enabled, themes.context);
  if (channel.detail) {
    return `${pill}${themes.dim(`(${channel.detail})`)}`;
  }
  return pill;
}

function formatTurn(snapshot: StatusSnapshot): string {
  if (snapshot.turn === null) {
    return themes.dim("t—");
  }
  return themes.dim(`t${snapshot.turn}`);
}

/** Default single-line REPL status bar (compact). */
export function formatStatusLine(snapshot: StatusSnapshot): string {
  const phasePaint =
    snapshot.phase === "running" ? themes.phaseRunning("run") : themes.phase("idle");

  const pills = [
    formatCtxPill(snapshot.context),
    formatCompactPill("tr", snapshot.trace.enabled, themes.trace),
    formatCompactPill("ev↓", snapshot.eventsStream.enabled, themes.events),
    formatCompactPill("ev▦", snapshot.eventsDisplay.enabled, themes.events),
    formatTurn(snapshot),
  ].join(" ");

  return [chalk.bold("Oculeau"), phasePaint, pills].join(" ");
}

function formatVerbosePill(
  name: string,
  channel: ChannelStatus,
  color: typeof themes.context,
): string {
  const state = channel.enabled ? color.bold(`${name} ON`) : themes.dim(`${name} OFF`);
  if (channel.detail) {
    return `${state}${themes.dim(` (${channel.detail})`)}`;
  }
  return state;
}

/** Full status for /status. */
export function formatStatusLineVerbose(snapshot: StatusSnapshot): string {
  const phasePaint =
    snapshot.phase === "running" ? themes.phaseRunning("running") : themes.phase("idle");

  const turnLabel =
    snapshot.turn !== null ? themes.dim(`turn ${snapshot.turn}`) : themes.dim("turn —");

  const pills = [
    formatVerbosePill("ctx", snapshot.context, themes.context),
    formatVerbosePill("trace", snapshot.trace, themes.trace),
    formatVerbosePill("stream", snapshot.eventsStream, themes.events),
    formatVerbosePill("display", snapshot.eventsDisplay, themes.events),
    turnLabel,
  ].join(themes.dim(" · "));

  return [
    chalk.bold("Oculeau"),
    themes.dim(snapshot.model),
    themes.dim(snapshot.workdir),
    phasePaint,
    pills,
  ].join(themes.dim(" · "));
}

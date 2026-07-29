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

function formatChannel(
  name: string,
  channel: ChannelStatus,
  color: typeof themes.context,
): string {
  const state = channel.enabled ? color("on") : themes.dim("off");
  let text = `${color(name)} ${state}`;
  if (channel.detail) {
    text += themes.dim(` (${channel.detail})`);
  }
  return text;
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

  const channels = [
    formatChannel("context", snapshot.context, themes.context),
    formatChannel("trace", snapshot.trace, themes.trace),
    formatChannel("stream", snapshot.eventsStream, themes.events),
    formatChannel("display", snapshot.eventsDisplay, themes.events),
    formatTurn(snapshot),
  ].join(themes.dim(" · "));

  return [chalk.bold("Oculeau"), phasePaint, channels].join(themes.dim(" · "));
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
    formatVerbosePill("context", snapshot.context, themes.context),
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

/** Legend text for /help. */
export function formatStatusLineLegend(): string {
  return [
    "Statusline: context/trace/stream/display on|off · turn N",
    "  context = stderr context box · trace = stderr timeline",
    "  stream = stdout NDJSON (--events) · display = stderr EVENT lines",
  ].join("\n");
}

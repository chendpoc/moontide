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

function formatPill(
  name: string,
  channel: ChannelStatus,
  color: typeof themes.context,
): string {
  const state = channel.enabled ? color.bold(`${name} ON`) : themes.dim(`${name} OFF`);
  if (channel.enabled && channel.detail) {
    return `${state}${themes.dim(` ${channel.detail}`)}`;
  }
  if (!channel.enabled && channel.detail && name === "ctx") {
    return `${state}${themes.dim(` (${channel.detail})`)}`;
  }
  return state;
}

/** Single-line REPL status bar. */
export function formatStatusLine(snapshot: StatusSnapshot): string {
  const phasePaint =
    snapshot.phase === "running" ? themes.phaseRunning("running") : themes.phase("idle");

  const turnLabel =
    snapshot.turn !== null ? themes.dim(`turn ${snapshot.turn}`) : themes.dim("turn —");

  const ctxChannel: ChannelStatus = {
    enabled: snapshot.context.enabled,
    detail: snapshot.context.detail,
  };

  const pills = [
    formatPill("ctx", ctxChannel, themes.context),
    formatPill("trace", snapshot.trace, themes.trace),
    formatPill("stream", snapshot.eventsStream, themes.events),
    formatPill("display", snapshot.eventsDisplay, themes.events),
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

import chalk from "chalk";

import { pickActivityQuote } from "../../i18n/activity/index.js";
import { getReplPhase } from "./collect.js";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

let frameIndex = 0;
let quote = "";
let timer: ReturnType<typeof setInterval> | null = null;
let onTick: (() => void) | null = null;
let repaintEnabled = true;

export function setActivityTickHandler(handler: (() => void) | null): void {
  onTick = handler;
}

/** When false, spinner ticks do not trigger StatusStack repaint (readline owns cursor). */
export function setActivityRepaintEnabled(enabled: boolean): void {
  repaintEnabled = enabled;
}

export function isActivityRepaintEnabled(): boolean {
  return repaintEnabled;
}

export function formatActivityLine(): string | null {
  if (getReplPhase() !== "running" || timer === null) {
    return null;
  }
  const frame = FRAMES[frameIndex] ?? FRAMES[0]!;
  return `${chalk.cyan(frame)} ${chalk.dim(quote)}`;
}

export function startActivityLine(): void {
  stopActivityLine();
  quote = pickActivityQuote();
  frameIndex = 0;
  timer = setInterval(() => {
    frameIndex = (frameIndex + 1) % FRAMES.length;
    if (repaintEnabled) {
      onTick?.();
    }
  }, 80);
}

export function stopActivityLine(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

export function resetActivityForTest(): void {
  stopActivityLine();
  quote = "";
  frameIndex = 0;
  onTick = null;
  repaintEnabled = true;
}

export function advanceActivityFrameForTest(): void {
  frameIndex = (frameIndex + 1) % FRAMES.length;
}

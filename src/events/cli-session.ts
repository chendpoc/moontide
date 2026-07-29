import { contextDisplayEnabled, eventsDisplayEnabled, eventsEnabled, traceEnabled } from "../config.js";

let cliEventsArgv = false;
let traceOverride: boolean | null = null;
let contextOverride: boolean | null = null;
let eventsOverride: boolean | null = null;
let eventsDisplayOverride: boolean | null = null;

export function setCliEventsArgv(enabled: boolean): void {
  cliEventsArgv = enabled;
}

export function setTraceCliOverride(value: boolean | null): void {
  traceOverride = value;
}

export function setContextCliOverride(value: boolean | null): void {
  contextOverride = value;
}

export function setEventsOverride(value: boolean | null): void {
  eventsOverride = value;
}

export function setEventsDisplayCliOverride(value: boolean | null): void {
  eventsDisplayOverride = value;
}

export function shouldShowTraceCli(): boolean {
  if (traceOverride !== null) {
    return traceOverride;
  }
  return traceEnabled();
}

export function shouldShowContextCli(): boolean {
  if (contextOverride !== null) {
    return contextOverride;
  }
  return contextDisplayEnabled();
}

/** stderr human-readable EVENT lines (user_prompt / audit); default off. */
export function shouldShowEventsCli(): boolean {
  if (eventsDisplayOverride !== null) {
    return eventsDisplayOverride;
  }
  return eventsDisplayEnabled();
}

export function isEventsMode(): boolean {
  if (eventsOverride !== null) {
    return eventsOverride;
  }
  return cliEventsArgv || eventsEnabled();
}

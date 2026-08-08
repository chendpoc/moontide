import {
  JsonlWriter,
  resetEventPlatform,
  setOnResetRun,
  setOutputs,
  type EventOutput,
} from "@moontide/log";
import { getWorkdir } from "../config.js";
import { resetTerminalRenderState } from "./format/terminal.js";
import { StderrRenderer } from "./outputs/stderr-renderer.js";

/** Connect Agent Event outputs (jsonl + stderr). Product-layer assembly. */
export function configureOutputs(workdir = getWorkdir()): void {
  setOnResetRun(resetTerminalRenderState);
  const eventOutputs: EventOutput[] = [
    new JsonlWriter({ workdir }),
    new StderrRenderer(),
  ];
  setOutputs(eventOutputs);
}

export function refreshEventOutputs(): void {
  configureOutputs();
}

export { resetEventPlatform };

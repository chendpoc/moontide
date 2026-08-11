import { JsonlWriter, setOnResetRun } from "@moontide/log";

import type { AgentEventPipeline } from "@moontide/agent";
import { reportError, type ReportErrorOptions } from "../errors/report.js";
import { writeStderrBlock } from "../terminal/write.js";
import { resetTerminalRenderState } from "./format/terminal.js";
import { StderrRenderer } from "./outputs/stderr-renderer.js";

export function createCliEventPipeline(workdir: string): AgentEventPipeline {
  setOnResetRun(resetTerminalRenderState);
  return {
    outputs: [new JsonlWriter({ workdir }), new StderrRenderer()],
    publishError: (record, options) =>
      reportError(record, options as ReportErrorOptions | undefined),
    writeDebugTerminal: (formatted) => writeStderrBlock(formatted),
  };
}

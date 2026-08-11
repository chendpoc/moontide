import { JsonlWriter } from "@moontide/log";

import type { AgentEventPipeline } from "../agent/event-pipeline.js";
import type { AgentRuntime } from "../agent/runtime/index.js";
import { createAgentRuntime, setAgentRuntime } from "../agent/runtime/index.js";
import { setupToolsPorts } from "../agent/tools-setup.js";
import { publishHarnessAgentError } from "../log/publish-agent-error.js";
import { registerBuiltinWorkMemPorts } from "../plugins/builtin/work-mem/register.js";
import { setupAgentEventPipeline } from "./bootstrap.js";

/** Eval pipeline: JSONL outputs + structured errors; no terminal stderr. */
export function createEvalEventPipeline(workdir: string): AgentEventPipeline {
  return {
    outputs: [new JsonlWriter({ workdir })],
    publishError: publishHarnessAgentError,
  };
}

/** Tools + work-mem ports + eval event pipeline (no sidecar attach). */
export function setupEvalHarness(runtime: AgentRuntime, workdir: string): void {
  setupToolsPorts();
  registerBuiltinWorkMemPorts();
  setupAgentEventPipeline(runtime, createEvalEventPipeline(workdir), workdir);
}

/** Create runtime and wire eval harness pipeline. */
export function installEvalHarness(workdir: string): AgentRuntime {
  const runtime = createAgentRuntime();
  setAgentRuntime(runtime);
  setupEvalHarness(runtime, workdir);
  return runtime;
}

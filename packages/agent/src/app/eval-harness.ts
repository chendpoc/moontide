import { JsonlWriter } from "@moontide/log";

import type { AgentEventOutputs } from "../agent/event-outputs.js";
import type { AgentRuntime } from "../agent/runtime/index.js";
import { createAgentRuntime, setAgentRuntime } from "../agent/runtime/index.js";
import { setupToolsPorts } from "../agent/tools-setup.js";
import { publishHarnessAgentError } from "../log/publish-agent-error.js";
import { registerBuiltinWorkMemPorts } from "../plugins/builtin/work-mem/register.js";
import { setupAgentEventOutputs } from "./bootstrap.js";

/** Eval event outputs: JSONL + structured errors; no terminal stderr. */
export function createEvalEventOutputs(workdir: string): AgentEventOutputs {
  return {
    outputs: [new JsonlWriter({ workdir })],
    publishError: publishHarnessAgentError,
  };
}

/** Tools + work-mem ports + eval event outputs (no sidecar attach). */
export function setupEvalHarness(runtime: AgentRuntime, workdir: string): void {
  setupToolsPorts();
  registerBuiltinWorkMemPorts();
  setupAgentEventOutputs(runtime, createEvalEventOutputs(workdir), workdir);
}

/** Create runtime and wire eval harness event outputs. */
export function installEvalHarness(workdir: string): AgentRuntime {
  const runtime = createAgentRuntime();
  setAgentRuntime(runtime);
  setupEvalHarness(runtime, workdir);
  return runtime;
}

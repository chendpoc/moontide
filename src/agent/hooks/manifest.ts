import { resetInstructionStateCache } from "../../instruction-state/index.js";
import {
  createAgentEventDeriveHandler,
  deriveFinalReply,
} from "../../plugins/builtin/log-sync/derive-observer.js";
import { handleLlmCallMetrics } from "../../plugins/builtin/context/hook-module.js";
import { buildToolUseLogDrafts } from "../../plugins/builtin/tool-use-log/module.js";
import { finalizeRunOutputs } from "../../log/event-hub.js";
import { getRunId, resetRun } from "../../log/run.js";
import type { HookErrorPolicy, HookPhase } from "./phases.js";
import type { SidecarHookRegistry } from "../runtime/hook-registry.js";

export type HookRegistrationSpec = {
  phase: HookPhase;
  name: string;
  errorPolicy?: HookErrorPolicy;
  order?: number;
  register: (hooks: SidecarHookRegistry, workdir: string) => () => void;
};

export function buildDefaultHookManifest(): HookRegistrationSpec[] {
  return [
    {
      phase: "runEnd",
      name: "derive-final",
      register: (hooks) =>
        hooks.on("runEnd", "derive-final", ({ reply, turn }) => {
          deriveFinalReply(turn, reply);
        }),
    },
    {
      phase: "runFinalize",
      name: "finalize-outputs",
      register: (hooks) =>
        hooks.on("runFinalize", "finalize-outputs", () => {
          finalizeRunOutputs(getRunId());
        }),
    },
    {
      phase: "sessionItem",
      name: "agent-event-derive",
      errorPolicy: "fail-open",
      order: 10,
      register: (hooks) =>
        hooks.on("sessionItem", "agent-event-derive", createAgentEventDeriveHandler(), {
          errorPolicy: "fail-open",
          order: 10,
        }),
    },
    {
      phase: "llmCall",
      name: "context-metrics",
      order: 0,
      register: (hooks) =>
        hooks.on("llmCall", "context-metrics", (record) => handleLlmCallMetrics(record), {
          order: 0,
        }),
    },
    {
      phase: "toolUse",
      name: "tool-use-log",
      order: 0,
      register: (hooks) =>
        hooks.on("toolUse", "tool-use-log", (record) => buildToolUseLogDrafts(record), {
          order: 0,
        }),
    },
  ];
}

export function prepareRun(preparedRunId?: string): void {
  resetRun(preparedRunId);
  resetInstructionStateCache();
}

import { resetInstructionStateCache } from "../../instruction-state/index.js";
import { getWorkdir } from "../../config.js";
import { appendSessionItemToFile } from "../../extensions/log-sync/file-item.js";
import {
  createAgentEventDeriveHandler,
  deriveFinalReply,
} from "../../extensions/log-sync/derive-observer.js";
import { handleLlmCallMetrics } from "../../extensions/context/hook-module.js";
import { buildToolUseLogDrafts } from "../../extensions/tool-use-log/module.js";
import { finalizeRunOutputs } from "../../log/event-hub.js";
import { getRunId, resetRun } from "../../log/run.js";
import type { HookErrorPolicy, HookPhase } from "./phases.js";
import { sidecarHooks, type SidecarHookRegistry } from "./registry.js";

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
      name: "file",
      errorPolicy: "fail-closed",
      order: 0,
      register: (hooks, workdir) =>
        hooks.on(
          "sessionItem",
          "file",
          ({ item }) => appendSessionItemToFile(item, workdir),
          { errorPolicy: "fail-closed", order: 0 },
        ),
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

const defaultDisposers: Array<() => void> = [];

export function prepareRun(preparedRunId?: string): void {
  resetRun(preparedRunId);
  resetInstructionStateCache();
}

export function registerDefaultSidecarHooks(workdir = getWorkdir()): void {
  clearDefaultSidecarHooks();
  const hooks = sidecarHooks();
  for (const spec of buildDefaultHookManifest()) {
    defaultDisposers.push(spec.register(hooks, workdir));
  }
}

export function clearDefaultSidecarHooks(): void {
  for (const dispose of defaultDisposers) {
    dispose();
  }
  defaultDisposers.length = 0;
}

export function resetSidecarHooks(): void {
  clearDefaultSidecarHooks();
  sidecarHooks().clear();
}

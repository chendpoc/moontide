import { resetInstructionStateCache } from "../../instruction-state/index.js";
import { handleLlmCallMetrics } from "../../plugins/builtin/context/hook-module.js";
import {
  handleDebugCompose,
  handleDebugLlmCall,
  handleDebugToolUse,
} from "../../plugins/builtin/context/debug-hook-module.js";
import { buildToolUseLogDrafts } from "../../plugins/builtin/tool-use-log/module.js";
import { resetRun } from "../../log/index.js";
import type { ObserverErrorPolicy, ObserverPhase } from "./phases.js";
import type { SidecarRunObserverRegistry } from "../runtime/observer-registry.js";

export type ObserverRegistrationSpec = {
  phase: ObserverPhase;
  name: string;
  errorPolicy?: ObserverErrorPolicy;
  order?: number;
  register: (hooks: SidecarRunObserverRegistry, workdir: string) => () => void;
};

/** Built-in hook registrations (context metrics, inspect-debug, tool-use-log). Run observability via RunEvent derive (M6). */
export function buildDefaultObserverManifest(): ObserverRegistrationSpec[] {
  return [
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
      phase: "composeComplete",
      name: "inspect-debug",
      order: 100,
      register: (hooks) =>
        hooks.on("composeComplete", "inspect-debug", handleDebugCompose, { order: 100 }),
    },
    {
      phase: "llmCall",
      name: "inspect-debug",
      order: 100,
      register: (hooks) =>
        hooks.on("llmCall", "inspect-debug", handleDebugLlmCall, { order: 100 }),
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
    {
      phase: "toolUse",
      name: "inspect-debug",
      order: 100,
      register: (hooks) =>
        hooks.on("toolUse", "inspect-debug", handleDebugToolUse, { order: 100 }),
    },
  ];
}

export function prepareRun(preparedRunId?: string): void {
  resetRun(preparedRunId);
  resetInstructionStateCache();
}

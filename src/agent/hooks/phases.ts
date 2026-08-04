import type { AgentChannel, AgentPhase } from "../../log/types.js";

export type HookMode = "observe" | "transform" | "decide";

export type HookPhase =
  | "sessionItem"
  | "composeComplete"
  | "runStart"
  | "runEnd"
  | "runFinalize"
  | "runError"
  | "beforeToolUse"
  | "toolUse"
  | "llmCall";

export type HookErrorPolicy = "fail-open" | "fail-closed";

export interface PhaseDef {
  mode: HookMode;
  defaultErrorPolicy: HookErrorPolicy;
  errorChannel: AgentChannel;
  errorPhase: AgentPhase;
}

export const PHASE_DEFS: Record<HookPhase, PhaseDef> = {
  sessionItem: {
    mode: "observe",
    defaultErrorPolicy: "fail-open",
    errorChannel: "trace",
    errorPhase: "pre_llm",
  },
  composeComplete: {
    mode: "observe",
    defaultErrorPolicy: "fail-open",
    errorChannel: "trace",
    errorPhase: "pre_llm",
  },
  runStart: {
    mode: "observe",
    defaultErrorPolicy: "fail-open",
    errorChannel: "trace",
    errorPhase: "pre_llm",
  },
  runEnd: {
    mode: "observe",
    defaultErrorPolicy: "fail-open",
    errorChannel: "trace",
    errorPhase: "stop",
  },
  runFinalize: {
    mode: "observe",
    defaultErrorPolicy: "fail-open",
    errorChannel: "trace",
    errorPhase: "pre_llm",
  },
  runError: {
    mode: "observe",
    defaultErrorPolicy: "fail-open",
    errorChannel: "trace",
    errorPhase: "pre_llm",
  },
  beforeToolUse: {
    mode: "decide",
    defaultErrorPolicy: "fail-closed",
    errorChannel: "tool_use_log",
    errorPhase: "post_tool",
  },
  toolUse: {
    mode: "observe",
    defaultErrorPolicy: "fail-open",
    errorChannel: "tool_use_log",
    errorPhase: "post_tool",
  },
  llmCall: {
    mode: "observe",
    defaultErrorPolicy: "fail-open",
    errorChannel: "context",
    errorPhase: "post_llm",
  },
};

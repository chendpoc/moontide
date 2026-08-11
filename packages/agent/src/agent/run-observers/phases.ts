import type { AgentChannel, AgentPhase } from "@moontide/log";

export type ObserverMode = "observe" | "transform" | "decide";

export type ObserverPhase =
  | "sessionItem"
  | "composeComplete"
  | "runStart"
  | "runEnd"
  | "runFinalize"
  | "runError"
  | "turnStart"
  | "turnEnd"
  | "beforeToolUse"
  | "toolUse"
  | "llmCall";

export type ObserverErrorPolicy = "fail-open" | "fail-closed";

export interface PhaseDef {
  mode: ObserverMode;
  defaultErrorPolicy: ObserverErrorPolicy;
  errorChannel: AgentChannel;
  errorPhase: AgentPhase;
}

export const PHASE_DEFS: Record<ObserverPhase, PhaseDef> = {
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
  turnStart: {
    mode: "observe",
    defaultErrorPolicy: "fail-open",
    errorChannel: "trace",
    errorPhase: "pre_llm",
  },
  turnEnd: {
    mode: "observe",
    defaultErrorPolicy: "fail-open",
    errorChannel: "trace",
    errorPhase: "post_llm",
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

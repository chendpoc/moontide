/** Legacy hook phase names; sidecar extensions register against these until RunConfig migration (M7). */
export type SidecarHookPhase =
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

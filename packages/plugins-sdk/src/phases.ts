/** Sidecar run observer phase names (RunConfig decision + RunEvent observe bridge). */
export type SidecarObserverPhase =
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

/** @deprecated Use SidecarObserverPhase */
export type SidecarHookPhase = SidecarObserverPhase;

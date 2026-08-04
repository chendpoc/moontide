export { PHASE_DEFS } from "./phases.js";
export type { HookErrorPolicy, HookMode, HookPhase } from "./phases.js";
export type {
  HookContextMap,
  HookDecideResult,
  HookDispatchResultMap,
  HookFailureRecord,
  HookHandler,
  HookHandlerResult,
  HookRegistration,
  StepObserveResult,
  ToolUseContext,
} from "./types.js";
export { sidecarHooks, getHookRegistrations } from "./registry.js";
export { HookDispatcher, HookObserverError, hookDispatcher } from "./dispatcher.js";
export { logHookFailure, emitHookError, toHookFailureRecord } from "./failures.js";
export { parseStepObserveResult } from "./parse-events.js";
export {
  clearDefaultSidecarHooks,
  prepareRun,
  registerDefaultSidecarHooks,
  resetSidecarHooks,
} from "./defaults.js";

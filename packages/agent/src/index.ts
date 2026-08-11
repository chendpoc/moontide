export type { AgentErrorRoute, AgentEventOutputs, AgentPlatformOptions, PublishAgentErrorOptions } from "./agent/event-outputs.js";
export type { RunEventListener } from "@moontide/agent-core";
export { extractTextReply } from "@moontide/agent-core";
export { publishAgentError } from "./agent/event-outputs.js";

export { runAgent, continueReplAgent } from "./agent/loop.js";
export { AgentSession } from "./agent/agent-session.js";
export type { AgentRunComposeOptions, AgentRunExecuteOptions } from "./agent/agent-run.js";
export { AgentRun } from "./agent/agent-run.js";

export type { LoopContext } from "./agent/deps.js";
export { createDefaultLoopContext } from "./agent/deps.js";

export {
  createAgentRuntime,
  getAgentRuntime,
  setAgentRuntime,
  AgentRuntime,
  RunObserverRegistry,
  ToolRegistry,
} from "./agent/runtime/index.js";
export type { SidecarRunObserverRegistry } from "./agent/runtime/index.js";

export {
  bootstrapAgentPlatform,
  setupAgentEventOutputs,
  setupAgentObservers,
  teardownAgentPlatform,
} from "./app/bootstrap.js";
export { findWorkspaceRoot, loadWorkspaceEnv } from "./app/load-env.js";
export {
  createEvalEventOutputs,
  installEvalHarness,
  setupEvalHarness,
} from "./app/eval-harness.js";

export { getWorkdir, setWorkdir } from "./config.js";
export {
  readWorkspaceConfig,
  writeWorkspaceConfig,
  workspaceConfigPath,
} from "./config/workspace-config.js";
export {
  thinkingModeDefault,
  verboseModeDefault,
  localeDefault,
  compactThreshold,
  modelId,
  tracePreviewChars,
} from "./config.js";

export { prepareRun } from "./agent/run-observers/index.js";

export { setupToolsPorts, resetToolsPortSetup } from "./agent/tools-setup.js";
export { registerBuiltinWorkMemPorts } from "./plugins/builtin/work-mem/register.js";

export {
  applyDeepPromptGate,
  getActiveWorkMemId,
  isDeepModeEnabled,
  resetDeepModeOnNewSession,
} from "./agent/deep-mode.js";

export { applyAgentEventOutputs } from "./log/event-outputs.js";
export { createRunEventDeriveListener } from "./log/run-event-derive.js";
export { resetEventPlatform } from "./log/index.js";

export {
  autoSaveSession,
  formatQuitHintLines,
  formatStartupHintLines,
  formatResumeCommand,
  formatSessionId,
  formatSessionLine,
  getActiveSessionMeta,
  getLatestSessionEntry,
  listSessions,
  loadSessionIndex,
  openSessionFromIndex,
  saveActiveSessionToIndex,
  saveSessionIndex,
  sessionExists,
  upsertSessionEntry,
} from "./plugins/builtin/session-persistence/index.js";
export type {
  ResumeSessionOutcome,
  SaveSessionOutcome,
  SessionLifecycleAccess,
  SessionIndex,
  SessionIndexEntry,
  SessionListEntry,
  UpsertSessionMeta,
} from "./plugins/builtin/session-persistence/index.js";

export { composePortsFromConfig } from "./agent/compose-options.js";
export {
  getLatestReport,
  getRuntimeTurn,
  resetRuntimeStatus,
} from "./agent/context-status.js";
export { resolveInstructionState } from "./instruction-state/index.js";
export {
  describeAlwaysAllow,
  getToolDefinitions,
  isAlwaysAllowEnabled,
  resetAlwaysAllowOverride,
  setAlwaysAllowOverride,
} from "./tools/index.js";
export { debugLogPath } from "./context-inspect/debug-file.js";
export {
  describeDebugMode,
  getDebugLevel,
  parseDebugLevelArg,
} from "./context-inspect/debug-mode.js";
export type { ContextAlert, ContextAlertCode, ContextReport, DetailLevel } from "./context-inspect/types.js";
export { emitDebugRecord } from "./context-inspect/debug-emit.js";
export {
  isDebugFileEnabled,
  isDebugTerminalEnabled,
  resetDebugOverride,
  setDebugOverride,
} from "./context-inspect/debug-mode.js";

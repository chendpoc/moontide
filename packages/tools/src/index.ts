import { resolveToolManifest } from "./define-tool.js";
import { DEFAULT_TOOL_MANIFEST } from "./manifest-entries.js";
import type { ToolDefinition } from "./types.js";

export function registerDefaultTools(): ToolDefinition[] {
  return resolveToolManifest(DEFAULT_TOOL_MANIFEST);
}

export { executeTool } from "./execute.js";
export { getToolDefinitions } from "./definitions.js";
export { TOOL_PERMISSIONS } from "./permission-table.js";
export { TOOL_CAPABILITIES } from "./capability-table.js";
export { TOOL_NAMES, type ToolName } from "./names.js";
export {
  defineTool,
  defineTools,
  defineOptionalTool,
  resolveToolManifest,
  validateToolSpec,
  toolDefinitionToSpec,
  type ToolSpec,
  type ToolFactory,
  type ToolManifestEntry,
} from "./define-tool.js";
export { ToolRegistry } from "./registry.js";
export { effectiveDecision, type TrustPolicy } from "./trust-policy.js";
export type { ToolRegistryPort } from "./registry-port.js";
export {
  DEFAULT_TOOL_MANIFEST,
  BUILTIN_TOOL_MANIFEST,
  BUILTIN_PLUGIN_TOOL_MANIFEST,
} from "./manifest-entries.js";
export {
  setToolsProductConfig,
  getToolsProductConfig,
  setInspectContextPort,
  setWorkMemToolPort,
  setHttpFetchExecutor,
  getHttpFetchExecutor,
  resetHttpFetchExecutor,
  type ToolsProductConfig,
  type InspectContextPort,
  type WorkMemToolPort,
  type HttpFetchExecutor,
} from "./ports/index.js";
export type {
  PermissionDecision,
  ToolCapability,
  ToolPermissionRule,
  UserInteraction,
  ToolContext,
  ToolHandler,
  ToolDefinition,
} from "./types.js";

export { runGrep, normalizeGrepMaxResults } from "./builtins/search/grep.js";
export { runHttpFetch, runHttpFetchNetwork, validateFetchUrl, normalizeMaxBytes, normalizeTimeoutMs } from "./builtins/network/http-fetch.js";
export type { HttpFetchInput, HttpFetchResult } from "./builtins/network/http-fetch.js";
export { runBash } from "./builtins/shell/bash.js";
export { safePath, runRead, runWrite, runEdit, runGlob, runListDir } from "./builtins/workspace/fs.js";
export { runGitDiff, runGitLog, runGitStatus, runGitSummaryLink } from "./builtins/git/lib.js";
export { executeCodeRepl } from "./extensions/code-repl/executor.js";
export { defineCodeReplTools } from "./extensions/code-repl/tools.js";
export { probeAll, registerRuntime } from "./extensions/code-repl/registry.js";
export type { CodeRuntime } from "./extensions/code-repl/types.js";
export { expandTemplate } from "./extensions/code-repl/templates/expand.js";
export { listTemplateIds } from "./extensions/code-repl/templates/catalog.js";
export { runDeepResearch } from "./extensions/deep-research/handler.js";
export { defineDeepResearchTools } from "./extensions/deep-research/tools.js";
export type { DeepResearchInput, DeepResearchResult } from "./extensions/deep-research/types.js";
export { tavilySearch, normalizeMaxResults } from "./extensions/deep-research/tavily.js";
export { runWorkMem } from "./extensions/work-mem/handler.js";
export { defineWorkMemTools } from "./extensions/work-mem/tools.js";
export { resolveWorkingSetSnapshot } from "./extensions/work-mem/escalation.js";
export type { ResolvedWorkingSet, ResolveWorkingSetInput } from "./extensions/work-mem/escalation.js";
export {
  appendWorkMemEvent,
  ensureWorkMemFile,
  readWorkMemEvents,
} from "./extensions/work-mem/store.js";
export { seedOutlineDraft } from "./extensions/work-mem/seed-outline.js";
export { WORK_MEM_CAP_NORMAL } from "./extensions/work-mem/config.js";
export { estimatePackTokens } from "./extensions/work-mem/summarize.js";
export type { WorkMemEvent, WorkMemPackTier } from "./extensions/work-mem/types.js";

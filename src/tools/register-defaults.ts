import { defineAskUserQuestionTool } from "./builtins/ask-user-question.js";
import { defineGitTools } from "./builtins/git-tools.js";
import { defineNetworkTools } from "./builtins/network-tools.js";
import { defineSearchTools } from "./builtins/search-tools.js";
import { defineShellTools } from "./builtins/shell-tools.js";
import { defineWorkspaceTools } from "./builtins/workspace-tools.js";
import { defineCodeReplTool } from "../plugins/builtin/code-repl/index.js";
import { defineDeepResearchTool } from "../plugins/builtin/deep-research/index.js";
import { defineInspectContextTool } from "../plugins/builtin/context/inspect-context.js";
import { resolveToolManifest, type ToolFactory, type ToolManifestEntry } from "./define-tool.js";
import type { ToolDefinition } from "./types.js";

function singleTool(factory: () => ToolDefinition): ToolFactory {
  return () => [factory()];
}

function optionalSingleTool(factory: () => ToolDefinition | null): ToolFactory {
  return () => {
    const tool = factory();
    return tool ? [tool] : null;
  };
}

/** Workspace file I/O and listing. */
export const WORKSPACE_TOOL_MANIFEST: ToolManifestEntry[] = [
  { factory: defineWorkspaceTools },
];

/** Shell execution. */
export const SHELL_TOOL_MANIFEST: ToolManifestEntry[] = [{ factory: defineShellTools }];

/** Code search. */
export const SEARCH_TOOL_MANIFEST: ToolManifestEntry[] = [{ factory: defineSearchTools }];

/** Network fetch. */
export const NETWORK_TOOL_MANIFEST: ToolManifestEntry[] = [{ factory: defineNetworkTools }];

/** Git read-only tools. */
export const GIT_TOOL_MANIFEST: ToolManifestEntry[] = [{ factory: defineGitTools }];

/** Workspace / shell / search / network / git builtins + context + user prompt. */
export const BUILTIN_TOOL_MANIFEST: ToolManifestEntry[] = [
  ...WORKSPACE_TOOL_MANIFEST,
  ...SHELL_TOOL_MANIFEST,
  ...SEARCH_TOOL_MANIFEST,
  ...NETWORK_TOOL_MANIFEST,
  ...GIT_TOOL_MANIFEST,
  { factory: singleTool(defineInspectContextTool) },
  { factory: singleTool(defineAskUserQuestionTool) },
];

/** Optional built-in plugin tools (code_repl, deep_research, …). */
export const BUILTIN_PLUGIN_TOOL_MANIFEST: ToolManifestEntry[] = [
  { factory: optionalSingleTool(defineCodeReplTool), optional: true },
  { factory: optionalSingleTool(defineDeepResearchTool), optional: true },
];

const DEFAULT_TOOL_MANIFEST: ToolManifestEntry[] = [
  ...BUILTIN_TOOL_MANIFEST,
  ...BUILTIN_PLUGIN_TOOL_MANIFEST,
];

export function registerDefaultTools(): ToolDefinition[] {
  return resolveToolManifest(DEFAULT_TOOL_MANIFEST);
}

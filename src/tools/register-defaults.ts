import { defineContextTools } from "./builtins/context/tools.js";
import { defineArtifactTools } from "./builtins/artifact/tools.js";
import { defineGitTools } from "./builtins/git/tools.js";
import { defineInteractionTools } from "./builtins/interaction/tools.js";
import { defineNetworkTools } from "./builtins/network/tools.js";
import { defineSearchTools } from "./builtins/search/tools.js";
import { defineShellTools } from "./builtins/shell/tools.js";
import { defineWorkspaceTools } from "./builtins/workspace/tools.js";
import { defineCodeReplTools } from "../plugins/builtin/code-repl/tools.js";
import { defineDeepResearchTools } from "../plugins/builtin/deep-research/tools.js";
import { resolveToolManifest, type ToolManifestEntry } from "./define-tool.js";
import type { ToolDefinition } from "./types.js";

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

/** User interaction tools. */
export const INTERACTION_TOOL_MANIFEST: ToolManifestEntry[] = [
  { factory: defineInteractionTools },
];

/** Context inspection tools. */
export const CONTEXT_TOOL_MANIFEST: ToolManifestEntry[] = [{ factory: defineContextTools }];

/** Session artifact tools (read spilled tool output). */
export const ARTIFACT_TOOL_MANIFEST: ToolManifestEntry[] = [{ factory: defineArtifactTools }];

/** Workspace / shell / search / network / git / interaction / context builtins. */
export const BUILTIN_TOOL_MANIFEST: ToolManifestEntry[] = [
  ...WORKSPACE_TOOL_MANIFEST,
  ...SHELL_TOOL_MANIFEST,
  ...SEARCH_TOOL_MANIFEST,
  ...NETWORK_TOOL_MANIFEST,
  ...GIT_TOOL_MANIFEST,
  ...INTERACTION_TOOL_MANIFEST,
  ...CONTEXT_TOOL_MANIFEST,
  ...ARTIFACT_TOOL_MANIFEST,
];

/** Optional built-in plugin tools (code_repl, deep_research, …). */
export const BUILTIN_PLUGIN_TOOL_MANIFEST: ToolManifestEntry[] = [
  { factory: defineCodeReplTools, optional: true },
  { factory: defineDeepResearchTools, optional: true },
];

const DEFAULT_TOOL_MANIFEST: ToolManifestEntry[] = [
  ...BUILTIN_TOOL_MANIFEST,
  ...BUILTIN_PLUGIN_TOOL_MANIFEST,
];

export function registerDefaultTools(): ToolDefinition[] {
  return resolveToolManifest(DEFAULT_TOOL_MANIFEST);
}

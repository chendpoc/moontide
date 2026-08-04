import { defineAskUserQuestionTool } from "../builtins/ask-user-question.js";
import { defineBuiltinFsTools } from "../builtins/fs-tools.js";
import { defineGitTools } from "../builtins/git-tools.js";
import { defineCodeReplTool } from "../extensions/code-repl/index.js";
import { defineDeepResearchTool } from "../extensions/deep-research/index.js";
import { defineInspectContextTool } from "../extensions/context/inspect-context.js";
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

const DEFAULT_TOOL_MANIFEST: ToolManifestEntry[] = [
  { factory: defineBuiltinFsTools },
  { factory: defineGitTools },
  { factory: singleTool(defineInspectContextTool) },
  { factory: singleTool(defineAskUserQuestionTool) },
  { factory: optionalSingleTool(defineCodeReplTool), optional: true },
  { factory: optionalSingleTool(defineDeepResearchTool), optional: true },
];

export function registerDefaultTools(): ToolDefinition[] {
  return resolveToolManifest(DEFAULT_TOOL_MANIFEST);
}

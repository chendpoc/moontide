import { defineAskUserQuestionTool } from "../builtins/ask-user-question.js";
import { defineBuiltinFsTools } from "../builtins/fs-tools.js";
import { defineGitTools } from "../builtins/git-tools.js";
import { defineCodeReplTool } from "../extensions/code-repl/index.js";
import { defineDeepResearchTool } from "../extensions/deep-research/index.js";
import { defineInspectContextTool } from "../extensions/context/inspect-context.js";
import type { ToolDefinition } from "./types.js";

export function registerDefaultTools(): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    ...defineBuiltinFsTools(),
    ...defineGitTools(),
    defineInspectContextTool(),
    defineAskUserQuestionTool(),
  ];

  const codeRepl = defineCodeReplTool();
  if (codeRepl) {
    tools.push(codeRepl);
  }

  const deepResearch = defineDeepResearchTool();
  if (deepResearch) {
    tools.push(deepResearch);
  }

  return tools;
}

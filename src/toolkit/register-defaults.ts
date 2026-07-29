import { defineAskUserQuestionTool } from "../builtins/ask-user-question.js";
import { defineBuiltinFsTools } from "../builtins/fs-tools.js";
import { defineGitTools } from "../builtins/git-tools.js";
import { defineCodeReplTool } from "../extensions/code-repl/index.js";
import { defineDeepResearchTool } from "../extensions/deep-research/index.js";
import { defineInspectContextTool } from "../extensions/context/inspect-context.js";
import { createToolCatalog, type ToolCatalog } from "./catalog.js";

export function createDefaultCatalog(): ToolCatalog {
  const tools = [
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

  return createToolCatalog(tools);
}

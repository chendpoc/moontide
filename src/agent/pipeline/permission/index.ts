import { TOOL_NAMES } from "../../../tools/names.js";
import { isOutsideWorkspace } from "../../../utils/path.js";
import { checkBashCommand } from "./patterns.js";

export type Decision = "allow" | "deny" | "ask";

type ToolRule =
  | { kind: "fixed"; decision: Decision }
  | { kind: "bash"; field: "command" }
  | { kind: "path"; field: "path" };

const TOOL_RULES: Record<string, ToolRule> = {
  [TOOL_NAMES.BASH]: { kind: "bash", field: "command" },
  [TOOL_NAMES.READ_FILE]: { kind: "path", field: "path" },
  [TOOL_NAMES.WRITE_FILE]: { kind: "path", field: "path" },
  [TOOL_NAMES.EDIT_FILE]: { kind: "path", field: "path" },
  [TOOL_NAMES.CODE_REPL]: { kind: "fixed", decision: "allow" },
  [TOOL_NAMES.DEEP_RESEARCH]: { kind: "fixed", decision: "ask" },
  [TOOL_NAMES.HTTP_FETCH]: { kind: "fixed", decision: "ask" },
};

function checkWorkspacePath(filePath: string): Decision {
  if (!filePath || !isOutsideWorkspace(filePath)) {
    return "allow";
  }
  return "ask";
}

function applyToolRule(rule: ToolRule, toolInput: Record<string, unknown>): Decision {
  switch (rule.kind) {
    case "fixed":
      return rule.decision;
    case "bash":
      return checkBashCommand(String(toolInput[rule.field] ?? ""));
    case "path":
      return checkWorkspacePath(String(toolInput[rule.field] ?? ""));
  }
}

/** Single entry: every LLM tool_use goes through here before execute. */
export function checkPermission(
  toolName: string,
  toolInput: Record<string, unknown>,
): Decision {
  const rule = TOOL_RULES[toolName];
  return rule ? applyToolRule(rule, toolInput) : "allow";
}

export { escapesWorkspace, isOutsideWorkspace } from "../../../utils/path.js";

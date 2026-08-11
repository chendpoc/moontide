import type { AgentRuntime } from "../../runtime/index.js";
import { getWorkdir } from "../../../config.js";
import { isOutsideWorkspace } from "@moontide/shared/utils/path.js";
import type { PermissionDecision, ToolPermissionRule } from "@moontide/tools";
import { checkBashCommand } from "./patterns.js";

export type Decision = PermissionDecision;

function checkWorkspacePath(filePath: string): Decision {
  if (!filePath || !isOutsideWorkspace(filePath, getWorkdir())) {
    return "allow";
  }
  return "ask";
}

function applyToolRule(rule: ToolPermissionRule, toolInput: Record<string, unknown>): Decision {
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
  runtime: AgentRuntime,
): Decision {
  const tool = runtime.tools.getTool(toolName);
  if (!tool) {
    return "deny";
  }
  return applyToolRule(tool.permission, toolInput);
}

export { escapesWorkspace, isOutsideWorkspace } from "@moontide/shared/utils/path.js";

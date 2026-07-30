import { TOOL_NAMES } from "../../tools/names.js";
import { matchesDestructiveAsk, matchesGitAsk, matchesGrepAsk, matchesNetworkAsk, matchesSystemDeny } from "./patterns.js";
import { escapesWorkspace } from "./path.js";

export type Decision = "allow" | "deny" | "ask";

function checkBash(command: string): Decision {
  if (matchesSystemDeny(command)) {
    return "deny";
  }
  if (matchesNetworkAsk(command)) {
    return "ask";
  }
  if (matchesGrepAsk(command)) {
    return "ask";
  }
  if (matchesGitAsk(command)) {
    return "ask";
  }
  if (matchesDestructiveAsk(command)) {
    return "ask";
  }
  return "allow";
}

function checkWorkspacePath(filePath: string): Decision {
  if (!filePath || !escapesWorkspace(filePath)) {
    return "allow";
  }
  return "ask";
}

/** Single entry: every LLM tool_use goes through here before execute. */
export function checkPermission(
  toolName: string,
  toolInput: Record<string, unknown>,
): Decision {
  switch (toolName) {
    case TOOL_NAMES.BASH:
      return checkBash(String(toolInput.command ?? ""));

    case TOOL_NAMES.READ_FILE:
      return checkWorkspacePath(String(toolInput.path ?? ""));

    case TOOL_NAMES.WRITE_FILE:
    case TOOL_NAMES.EDIT_FILE:
      return checkWorkspacePath(String(toolInput.path ?? ""));

    case TOOL_NAMES.CODE_REPL:
      return "allow";

    case TOOL_NAMES.DEEP_RESEARCH:
      return "ask";

    case TOOL_NAMES.HTTP_FETCH:
      return "ask";

    default:
      return "allow";
  }
}

export { escapesWorkspace } from "./path.js";

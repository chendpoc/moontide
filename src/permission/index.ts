import { matchesDestructiveAsk, matchesGitAsk, matchesGrepAsk, matchesNetworkAsk, matchesSystemDeny } from "./patterns.js";
import { escapesWorkspace } from "./path.js";

export type Decision = "allow" | "deny" | "ask";

export type PolicyMode = "blocklist" | "allowlist";

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
    case "bash":
      return checkBash(String(toolInput.command ?? ""));

    case "read_file":
      return checkWorkspacePath(String(toolInput.path ?? ""));

    case "write_file":
    case "edit_file":
      return checkWorkspacePath(String(toolInput.path ?? ""));

    case "code_repl":
      return "allow";

    case "deep_research":
      return "ask";

    case "http_fetch":
      return "ask";

    default:
      return "allow";
  }
}

export { escapesWorkspace } from "./path.js";

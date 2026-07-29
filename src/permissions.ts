import path from "node:path";

import { getWorkdir } from "./config.js";

export type Decision = "allow" | "deny" | "ask";

const DENY_LIST = ["rm -rf /", "sudo", "shutdown", "reboot", "mkfs", "dd if="];
const DESTRUCTIVE_HINTS = ["rm ", "> /etc/", "chmod 777"];

function escapesWorkspace(filePath: string): boolean {
  const workdir = getWorkdir();
  const raw = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(workdir, filePath);
  const rel = path.relative(workdir, raw);
  return rel.startsWith("..") || path.isAbsolute(rel);
}

export function checkPermission(
  toolName: string,
  toolInput: Record<string, unknown>,
): Decision {
  if (toolName === "bash") {
    const command = String(toolInput.command ?? "");
    for (const pattern of DENY_LIST) {
      if (command.includes(pattern)) {
        return "deny";
      }
    }
    for (const hint of DESTRUCTIVE_HINTS) {
      if (command.includes(hint)) {
        return "ask";
      }
    }
  }

  if (
    (toolName === "write_file" || toolName === "edit_file") &&
    escapesWorkspace(String(toolInput.path ?? ""))
  ) {
    return "ask";
  }

  return "allow";
}

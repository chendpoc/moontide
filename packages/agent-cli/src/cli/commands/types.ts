import type { Interface } from "node:readline/promises";

import type { AgentSession } from "@moontide/agent";

export interface ReplCommandContext {
  rl: Interface;
  getAgentSession: () => AgentSession | null;
  resetConversation: () => void;
}

export type ReplCommandResult = "handled" | "unknown" | "not_command" | "exit";

export interface ParsedReplCommand {
  parts: string[];
  cmd: string;
  arg?: string;
  arg2?: string;
}

export function parseReplCommand(trimmed: string): ParsedReplCommand | null {
  if (!trimmed.startsWith("/")) {
    return null;
  }
  const parts = trimmed.split(/\s+/);
  return {
    parts,
    cmd: parts[0]!.toLowerCase(),
    arg: parts[1]?.toLowerCase(),
    arg2: parts[2]?.toLowerCase(),
  };
}

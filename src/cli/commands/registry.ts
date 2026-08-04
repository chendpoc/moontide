import { handleCheckpointCommand } from "./checkpoint.js";
import { handleCompactCommand } from "./compact.js";
import { handleHelpCommand } from "./help.js";
import { handleThinkingCommand, handleVerboseCommand } from "./observability.js";
import { handleResetCommand } from "./reset.js";
import { handleResumeCommand } from "./resume.js";
import { handleStatusCommand } from "./status.js";
import type { ParsedReplCommand, ReplCommandContext, ReplCommandResult } from "./types.js";
import { handleWorkdirCommand } from "./workdir.js";

export type ReplCommandHandler = (
  parsed: ParsedReplCommand,
  ctx: ReplCommandContext,
) => ReplCommandResult | Promise<ReplCommandResult>;

export interface ReplCommandSpec {
  name: string;
  aliases?: string[];
  helpLine?: string;
  handler: ReplCommandHandler;
}

export const REPL_COMMANDS: ReplCommandSpec[] = [
  {
    name: "/help",
    helpLine: "/help",
    handler: () => handleHelpCommand(),
  },
  {
    name: "/new",
    aliases: ["/reset"],
    helpLine: "/reset",
    handler: (_parsed, ctx) => handleResetCommand(ctx),
  },
  {
    name: "/status",
    helpLine: "/status",
    handler: async (_parsed, ctx) => handleStatusCommand(ctx),
  },
  {
    name: "/workdir",
    helpLine: "/workdir [path]",
    handler: (parsed) => handleWorkdirCommand(parsed),
  },
  {
    name: "/compact",
    helpLine: "/compact [preview|prune|summary] · /compact auto on|off",
    handler: (parsed, ctx) => handleCompactCommand(parsed, ctx),
  },
  {
    name: "/checkpoint",
    helpLine: "/checkpoint [label] · /checkpoint list",
    handler: (parsed, ctx) => handleCheckpointCommand(parsed, ctx),
  },
  {
    name: "/resume",
    helpLine: "/resume <checkpoint-id>",
    handler: (parsed, ctx) => handleResumeCommand(parsed, ctx),
  },
  {
    name: "/thinking",
    helpLine: "/thinking on|off  (call chain & debug trace)",
    handler: (parsed) => handleThinkingCommand(parsed.arg),
  },
  {
    name: "/verbose",
    helpLine: "/verbose on|off  (call chain & debug trace)",
    handler: (parsed) => handleVerboseCommand(parsed.arg),
  },
];

const COMMAND_BY_NAME = new Map<string, ReplCommandSpec>();

for (const spec of REPL_COMMANDS) {
  COMMAND_BY_NAME.set(spec.name, spec);
  for (const alias of spec.aliases ?? []) {
    COMMAND_BY_NAME.set(alias, spec);
  }
}

export function resolveReplCommand(cmd: string): ReplCommandSpec | undefined {
  return COMMAND_BY_NAME.get(cmd);
}

export function replCommandHelpLines(): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const spec of REPL_COMMANDS) {
    const line = spec.helpLine ?? spec.name;
    if (seen.has(line)) {
      continue;
    }
    seen.add(line);
    lines.push(line);
  }
  return lines;
}

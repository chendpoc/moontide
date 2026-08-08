import { handleAlwaysAllowCommand } from "./always-allow.js";
import { handleCheckpointCommand } from "./checkpoint.js";
import { handleCompactCommand } from "./compact.js";
import { handleHelpCommand } from "./help.js";
import { handleDebugCommand } from "./debug.js";
import { handleExitCommand } from "./exit.js";
import { handleThinkingCommand, handleVerboseCommand } from "./observability.js";
import { handleResetCommand } from "./reset.js";
import { handleResumeCommand } from "./resume.js";
import { handleSettingsCommand } from "./settings.js";
import { handleStatuslineCommand } from "./statusline.js";
import { handleStatusCommand } from "./status.js";
import { handleSaveCommand } from "../../plugins/builtin/session-persistence/index.js";
import { createSessionPersistenceDeps } from "../session-persistence-glue.js";
import type { ParsedReplCommand, ReplCommandContext, ReplCommandResult } from "./types.js";
import { handleWorkdirCommand } from "./workdir.js";
import { DATA_DIR } from "@moontide/shared/constants/storage.js";
import { APP_ENV, envVarName } from "@moontide/shared/constants/env.js";

const configPath = `${DATA_DIR}/config.toml`;
const langEnv = envVarName(APP_ENV.LANG);

export type ReplCommandHandler = (
  parsed: ParsedReplCommand,
  ctx: ReplCommandContext,
) => ReplCommandResult | Promise<ReplCommandResult>;

export type ReplHelpEntry = {
  syntax: string;
  summary: string;
};

export type ReplHelpSection = {
  category: string;
  entries: ReplHelpEntry[];
};

export interface ReplCommandSpec {
  name: string;
  aliases?: string[];
  helpCategory?: string;
  helpEntries?: ReplHelpEntry[];
  helpSummary?: string;
  handler: ReplCommandHandler;
}

export const REPL_COMMANDS: ReplCommandSpec[] = [
  {
    name: "/help",
    aliases: ["/h"],
    helpCategory: "General",
    helpSummary: "show this command list",
    handler: () => handleHelpCommand(),
  },
  {
    name: "/new",
    aliases: ["/reset"],
    helpCategory: "General",
    helpEntries: [{ syntax: "/reset · /new", summary: "new session (auto-saves current to index)" }],
    handler: (_parsed, ctx) => handleResetCommand(ctx),
  },
  {
    name: "/always-allow",
    helpCategory: "General",
    helpEntries: [
      {
        syntax: "/always-allow on|off|status",
        summary: "auto-approve ask-class tools (deny rules still apply)",
      },
    ],
    handler: (parsed) => handleAlwaysAllowCommand(parsed.arg),
  },
  {
    name: "/status",
    helpCategory: "General",
    helpSummary: "session and auto-compact state (status line is always visible above prompt)",
    handler: async (_parsed, ctx) => handleStatusCommand(ctx),
  },
  {
    name: "/workdir",
    helpCategory: "General",
    helpEntries: [{ syntax: "/workdir [path]", summary: "show or switch workspace directory" }],
    handler: (parsed) => handleWorkdirCommand(parsed),
  },
  {
    name: "/settings",
    helpCategory: "General",
    helpEntries: [
      {
        syntax: "/settings lang en|zh|status",
        summary: `UI language (persisted to ${configPath}; fallback ${langEnv})`,
      },
    ],
    handler: (parsed) => handleSettingsCommand(parsed.parts.slice(1).join(" ") || undefined),
  },
  {
    name: "/exit",
    aliases: ["/quit"],
    helpCategory: "General",
    helpEntries: [{ syntax: "/exit · /quit", summary: "leave REPL" }],
    handler: () => handleExitCommand(),
  },
  {
    name: "/save",
    helpCategory: "Session",
    helpEntries: [
      { syntax: "/save", summary: "write current session to index" },
      { syntax: "/save list", summary: "list saved and on-disk sessions" },
    ],
    handler: (parsed, ctx) => handleSaveCommand(parsed, createSessionPersistenceDeps(ctx)),
  },
  {
    name: "/resume",
    helpCategory: "Session",
    helpEntries: [
      { syntax: "/resume session <session-id> [checkpoint-id]", summary: "load session across restarts" },
      { syntax: "/resume <checkpoint-id>", summary: "restore checkpoint in current session" },
    ],
    handler: (parsed, ctx) => handleResumeCommand(parsed, ctx),
  },
  {
    name: "/checkpoint",
    helpCategory: "Session",
    helpEntries: [
      { syntax: "/checkpoint [label]", summary: "snapshot current turn" },
      { syntax: "/checkpoint list", summary: "list checkpoints in current session" },
    ],
    handler: (parsed, ctx) => handleCheckpointCommand(parsed, ctx),
  },
  {
    name: "/compact",
    helpCategory: "Context",
    helpEntries: [
      { syntax: "/compact", summary: "prune old tool results (writes compaction item)" },
      { syntax: "/compact preview", summary: "dry-run token estimate" },
      { syntax: "/compact summary", summary: "LLM summary compaction (extra API call)" },
      { syntax: "/compact auto on|off", summary: "toggle threshold auto-prune" },
    ],
    handler: (parsed, ctx) => handleCompactCommand(parsed, ctx),
  },
  {
    name: "/thinking",
    helpCategory: "Observability",
    helpEntries: [
      {
        syntax: "/thinking on|off|status",
        summary: "call-chain trace (thinking · tool · result)",
      },
    ],
    handler: (parsed) => handleThinkingCommand(parsed.arg),
  },
  {
    name: "/statusline",
    helpCategory: "Observability",
    helpEntries: [
      {
        syntax: "/statusline [set <ids>|reset|preview|status]",
        summary: `configure status line segments (persisted to ${configPath})`,
      },
    ],
    handler: (parsed) => handleStatuslineCommand(parsed.parts.slice(1).join(" ") || undefined),
  },
  {
    name: "/verbose",
    helpCategory: "Observability",
    helpEntries: [
      {
        syntax: "/verbose on|off|status",
        summary: "context one-liner + event trace (truncated previews)",
      },
    ],
    handler: (parsed) => handleVerboseCommand(parsed.arg),
  },
  {
    name: "/debug",
    helpCategory: "Observability",
    helpEntries: [
      {
        syntax: "/debug on|terminal|file|off|status",
        summary: "full compose / llm / tool dumps (no truncation)",
      },
    ],
    handler: (parsed) => handleDebugCommand(parsed.arg),
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

const HELP_CATEGORY_ORDER = ["General", "Session", "Context", "Observability"] as const;

function helpEntriesForSpec(spec: ReplCommandSpec): ReplHelpEntry[] {
  if (spec.helpEntries?.length) {
    return spec.helpEntries;
  }
  return [
    {
      syntax: spec.name,
      summary: spec.helpSummary ?? "",
    },
  ];
}

export function replCommandHelpSections(): ReplHelpSection[] {
  const byCategory = new Map<string, ReplHelpEntry[]>();

  for (const spec of REPL_COMMANDS) {
    const category = spec.helpCategory ?? "Other";
    const bucket = byCategory.get(category) ?? [];
    bucket.push(...helpEntriesForSpec(spec));
    byCategory.set(category, bucket);
  }

  const sections: ReplHelpSection[] = [];
  for (const category of HELP_CATEGORY_ORDER) {
    const entries = byCategory.get(category);
    if (entries?.length) {
      sections.push({ category, entries });
    }
  }

  const other = byCategory.get("Other");
  if (other?.length) {
    sections.push({ category: "Other", entries: other });
  }

  return sections;
}

export function replCommandHelpLines(): string[] {
  return replCommandHelpSections().flatMap((section) =>
    section.entries.map((entry) => entry.syntax),
  );
}

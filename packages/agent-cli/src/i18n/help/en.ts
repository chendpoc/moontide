import { ACTIVE_EVENTS_SUFFIX, DATA_DIR, RUNS_DIR } from "@moontide/shared/constants/storage.js";
import { APP_ENV, envVarName } from "@moontide/shared/constants/env.js";
import type { HelpStrings } from "./types.js";

const configPath = `${DATA_DIR}/config.toml`;
const langEnv = envVarName(APP_ENV.LANG);

export const helpEn: HelpStrings = {
  title: "REPL commands",
  legend: `Statusline: 2.2k/128k(1.7%) · turn N · /statusline · events → ${DATA_DIR}/${RUNS_DIR}/<runId>${ACTIVE_EVENTS_SUFFIX}`,
  languageHint: (lang) => `Language: ${lang} · switch with /settings lang en|zh`,
  categories: {
    general: "General",
    session: "Session",
    context: "Context",
    observability: "Observability",
  },
  summaries: {
    "/help": "show this command list",
    "/reset · /new": "new session (auto-saves current to index)",
    "/always-allow on|off|status": "auto-approve ask-class tools (deny rules still apply)",
    "/status": "session + compact auto state (status line stays above prompt)",
    "/workdir [path]": "show or switch workspace directory",
    "/settings lang en|zh|status": `UI language (persisted to ${configPath}; fallback ${langEnv})`,
    "/exit · /quit": "leave REPL",
    "/save": "write current session to index",
    "/save list": "list saved and on-disk sessions",
    "/resume session <session-id> [checkpoint-id]": "load session across restarts",
    "/resume <checkpoint-id>": "restore checkpoint in current session",
    "/checkpoint [label]": "snapshot current turn",
    "/checkpoint list": "list checkpoints in current session",
    "/compact": "prune old tool results (writes compaction item)",
    "/compact preview": "dry-run L2 token estimate",
    "/compact summary": "LLM summary compaction (extra API call)",
    "/compact auto on|off": "toggle L2-threshold auto-prune",
    "/statusline [set <ids>|reset|preview|status]": `configure status line segments (persisted to ${configPath})`,
    "/debug on|file|off|status": "append full compose / llm / tool records to debug jsonl (file only)",
  },
};

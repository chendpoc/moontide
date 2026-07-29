import type { Interface } from "node:readline/promises";

import { collectStatusSnapshot } from "./statusline/collect.js";
import { formatStatusLine, formatStatusLineLegend, formatStatusLineVerbose } from "./statusline/format.js";
import { renderStatusLine } from "./statusline/render.js";
import {
  defaultCompactSystem,
  emitCompactEvent,
  previewCompact,
  pruneCompact,
  summarizeCompact,
} from "../context/compact.js";
import { resetSession } from "../context/sessions.js";
import { getWorkdir, setWorkdir } from "../config.js";
import {
  isCompactAutoEnabled,
  resetReplSession,
  setCompactAutoOverride,
} from "./repl-session.js";
import {
  setContextCliOverride,
  setEventsDisplayCliOverride,
  setEventsOverride,
  setTraceCliOverride,
} from "../events/cli-session.js";
import { refreshEventSinks } from "../events/setup.js";
import { resetRun } from "../events/run.js";
import { TOOL_SCHEMAS } from "../tools/index.js";

export interface ReplCommandContext {
  rl: Interface;
  getMessages: () => import("@anthropic-ai/sdk/resources/messages/messages.js").MessageParam[] | null;
  resetConversation: () => void;
}

export type ReplCommandResult = "handled" | "unknown" | "not_command";

function reply(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

function toggle(
  value: string | undefined,
  on: () => void,
  off: () => void,
): boolean {
  const v = (value ?? "").toLowerCase();
  if (v === "on") {
    on();
    return true;
  }
  if (v === "off") {
    off();
    return true;
  }
  return false;
}

function handleToggleCommand(
  name: string,
  arg: string | undefined,
  on: () => void,
  off: () => void,
): boolean {
  if (!toggle(arg, on, off)) {
    reply(`${name}: use 'on' or 'off'`);
    return true;
  }
  renderStatusLine();
  return true;
}

function formatCompactReport(
  label: string,
  before: number,
  after: number,
  extra?: string,
): string {
  const saved = before - after;
  const tail = extra ? ` · ${extra}` : "";
  return `${label}: ${before.toLocaleString()} → ${after.toLocaleString()} tokens (saved ${saved.toLocaleString()})${tail}`;
}

export async function handleReplCommand(
  trimmed: string,
  ctx: ReplCommandContext,
): Promise<ReplCommandResult> {
  if (!trimmed.startsWith("/")) {
    return "not_command";
  }

  const parts = trimmed.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const arg = parts[1]?.toLowerCase();
  const arg2 = parts[2]?.toLowerCase();

  if (cmd === "/help") {
    reply("REPL commands:");
    reply("  /help · /reset · /status · /workdir [path]");
    reply("  /compact [preview|summary] · /compact auto on|off");
    reply("  /context|/trace|/events|/events-display on|off");
    reply("  q · exit");
    reply(formatStatusLineLegend());
    return "handled";
  }

  if (cmd === "/reset" || cmd === "/new") {
    ctx.resetConversation();
    reply("session reset");
    renderStatusLine();
    return "handled";
  }

  if (cmd === "/status") {
    const snapshot = collectStatusSnapshot();
    reply(formatStatusLineVerbose(snapshot));
    reply(
      `auto-compact: ${isCompactAutoEnabled() ? "on" : "off"} · messages: ${ctx.getMessages()?.length ?? 0}`,
    );
    return "handled";
  }

  if (cmd === "/workdir") {
    if (!parts[1]) {
      reply(`workdir: ${getWorkdir()}`);
      return "handled";
    }
    setWorkdir(parts.slice(1).join(" "));
    reply(`workdir: ${getWorkdir()}`);
    renderStatusLine();
    return "handled";
  }

  if (cmd === "/compact") {
    const messages = ctx.getMessages();
    if (!messages || messages.length === 0) {
      reply("nothing to compact — send a prompt first");
      return "handled";
    }

    const system = defaultCompactSystem();

    if (arg === "auto") {
      handleToggleCommand(
        "/compact auto",
        arg2,
        () => setCompactAutoOverride(true),
        () => setCompactAutoOverride(false),
      );
      return "handled";
    }

    if (arg === "preview") {
      const preview = previewCompact(messages, system, TOOL_SCHEMAS);
      reply(
        formatCompactReport(
          "preview",
          preview.beforeTokens,
          preview.afterTokens,
          `${preview.truncatedToolResults} tool results would shrink · keep from index ${preview.keepFromIndex}`,
        ),
      );
      return "handled";
    }

    if (arg === "summary") {
      const result = await summarizeCompact(messages, system, TOOL_SCHEMAS);
      messages.splice(0, messages.length, ...result.messages);
      emitCompactEvent(0, result, "summary");
      reply(formatCompactReport("summary compact", result.beforeTokens, result.afterTokens));
      renderStatusLine();
      return "handled";
    }

    const result = pruneCompact(messages, system, TOOL_SCHEMAS);
    if (!result.changed) {
      reply("already compact");
      return "handled";
    }
    messages.splice(0, messages.length, ...result.messages);
    emitCompactEvent(0, result, "prune");
    reply(
      formatCompactReport(
        "compact",
        result.beforeTokens,
        result.afterTokens,
        `${result.truncatedToolResults} tool results shrunk`,
      ),
    );
    renderStatusLine();
    return "handled";
  }

  if (cmd === "/trace") {
    if (!arg) {
      reply("usage: /trace on|off");
      return "handled";
    }
    return handleToggleCommand(
      "/trace",
      arg,
      () => setTraceCliOverride(true),
      () => setTraceCliOverride(false),
    )
      ? "handled"
      : "handled";
  }

  if (cmd === "/context") {
    if (!arg) {
      reply("usage: /context on|off");
      return "handled";
    }
    return handleToggleCommand(
      "/context",
      arg,
      () => setContextCliOverride(true),
      () => setContextCliOverride(false),
    )
      ? "handled"
      : "handled";
  }

  if (cmd === "/events") {
    if (!arg) {
      reply("usage: /events on|off  (stdout NDJSON stream)");
      return "handled";
    }
    if (toggle(arg, () => setEventsOverride(true), () => setEventsOverride(false))) {
      refreshEventSinks();
      renderStatusLine();
      return "handled";
    }
    reply("/events: use 'on' or 'off'");
    return "handled";
  }

  if (cmd === "/events-display") {
    if (!arg) {
      reply("usage: /events-display on|off");
      return "handled";
    }
    return handleToggleCommand(
      "/events-display",
      arg,
      () => setEventsDisplayCliOverride(true),
      () => setEventsDisplayCliOverride(false),
    )
      ? "handled"
      : "handled";
  }

  return "unknown";
}

export function resetReplConversation(): void {
  resetReplSession();
  resetSession();
  resetRun();
}

import {
  defaultCompactSystem,
  emitCompactEvent,
  previewCompact,
  pruneCompact,
  summarizeCompact,
} from "../../context/compact.js";
import { TOOL_SCHEMAS } from "../../agent/tools.js";
import { renderStatusLine } from "../statusline/render.js";
import { setCompactAutoOverride } from "../repl/session.js";
import { formatCompactReport, handleToggleCommand, reply } from "./io.js";
import type { ParsedReplCommand, ReplCommandContext, ReplCommandResult } from "./types.js";

export async function handleCompactCommand(
  parsed: ParsedReplCommand,
  ctx: ReplCommandContext,
): Promise<ReplCommandResult> {
  const messages = ctx.getMessages();
  if (!messages || messages.length === 0) {
    reply("nothing to compact — send a prompt first");
    return "handled";
  }

  const system = defaultCompactSystem();
  const { arg, arg2 } = parsed;

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

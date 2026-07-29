import { collectStatusSnapshot } from "../statusline/collect.js";
import { formatStatusLineVerbose } from "../statusline/format.js";
import { isCompactAutoEnabled } from "../repl/session.js";
import { reply } from "./io.js";
import type { ReplCommandContext, ReplCommandResult } from "./types.js";

export function handleStatusCommand(ctx: ReplCommandContext): ReplCommandResult {
  const snapshot = collectStatusSnapshot();
  reply(formatStatusLineVerbose(snapshot));
  reply(
    `auto-compact: ${isCompactAutoEnabled() ? "on" : "off"} · messages: ${ctx.getMessages()?.length ?? 0}`,
  );
  return "handled";
}

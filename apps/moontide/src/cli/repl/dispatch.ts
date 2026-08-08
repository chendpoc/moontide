import { handleReplCommand, type ReplCommandContext } from "../commands/repl.js";
import { writeStderrLine } from "../../terminal/write.js";

export type ReplLineAction =
  | { kind: "exit" }
  | { kind: "continue" }
  | { kind: "agent"; prompt: string };

/** Classify one REPL line: slash command, agent prompt, or empty continue. */
export async function resolveReplLine(
  trimmed: string,
  ctx: ReplCommandContext,
): Promise<ReplLineAction> {
  if (!trimmed) {
    return { kind: "continue" };
  }

  if (trimmed.startsWith("/")) {
    const result = await handleReplCommand(trimmed, ctx);
    if (result === "exit") {
      return { kind: "exit" };
    }
    if (result === "unknown") {
      writeStderrLine(`unknown command: ${trimmed.split(/\s+/)[0]} (try /help)`);
    }
    return { kind: "continue" };
  }

  return { kind: "agent", prompt: trimmed };
}

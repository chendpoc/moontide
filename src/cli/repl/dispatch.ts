import { handleReplCommand, type ReplCommandContext } from "../commands/repl.js";
import { writeStderrLine } from "../../terminal/write.js";

export type ReplLineAction =
  | { kind: "exit" }
  | { kind: "continue" }
  | { kind: "agent"; prompt: string };

const EXIT_INPUTS = new Set(["q", "exit"]);

/** Classify one REPL line: exit, slash command, or agent prompt. */
export async function resolveReplLine(
  trimmed: string,
  ctx: ReplCommandContext,
): Promise<ReplLineAction> {
  if (!trimmed || EXIT_INPUTS.has(trimmed.toLowerCase())) {
    return { kind: "exit" };
  }

  if (trimmed.startsWith("/")) {
    const result = await handleReplCommand(trimmed, ctx);
    if (result === "unknown") {
      writeStderrLine(`unknown command: ${trimmed.split(/\s+/)[0]} (try /help)`);
    }
    return { kind: "continue" };
  }

  return { kind: "agent", prompt: trimmed };
}

import { toMessage } from "../../../errors/normalize.js";
import type { ToolContext } from "../../types.js";

export async function runAskUserQuestion(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const title = input.title !== undefined ? String(input.title) : undefined;
  const rawQuestions = input.questions;
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    return JSON.stringify({ error: "questions array is required" });
  }

  const questions = rawQuestions.map((q) => {
    const item = q as Record<string, unknown>;
    const options = Array.isArray(item.options)
      ? item.options.map((opt) => {
          const o = opt as Record<string, unknown>;
          return { id: String(o.id ?? ""), label: String(o.label ?? "") };
        })
      : [];
    return {
      id: String(item.id ?? ""),
      prompt: String(item.prompt ?? ""),
      options,
      allow_multiple: item.allow_multiple === true,
    };
  });

  try {
    const answers = await ctx.userInteraction.askQuestion({ title, questions });
    return JSON.stringify({ answers });
  } catch (error) {
    return JSON.stringify({
      error: toMessage(error),
    });
  }
}

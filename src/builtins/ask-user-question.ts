import type { ToolDefinition } from "../agent/tools/types.js";
import { TOOL_NAMES } from "../agent/tools/names.js";

export function defineAskUserQuestionTool(): ToolDefinition {
  return {
    schema: {
      name: TOOL_NAMES.ASK_USER_QUESTION,
      description:
        "Ask the user structured multiple-choice questions and wait for answers. Use when runtime or environment is ambiguous.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Optional form title." },
          questions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                prompt: { type: "string" },
                allow_multiple: { type: "boolean" },
                options: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      label: { type: "string" },
                    },
                    required: ["id", "label"],
                  },
                },
              },
              required: ["id", "prompt", "options"],
            },
          },
        },
        required: ["questions"],
      },
    },
    handler: async (input, ctx) => {
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
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

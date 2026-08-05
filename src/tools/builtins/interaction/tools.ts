import { defineTools, type ToolSpec } from "../../define-tool.js";
import type { ToolDefinition } from "../../types.js";
import { TOOL_NAMES } from "../../names.js";
import { runAskUserQuestion } from "./ask-user-question.js";

const INTERACTION_TOOL_SPECS: ToolSpec[] = [
  {
    name: TOOL_NAMES.ASK_USER_QUESTION,
    description:
      "Ask the user structured multiple-choice questions and wait for answers. Use when runtime or environment is ambiguous.",
    permission: { kind: "fixed", decision: "allow" },
    capability: "read",
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
    run: (input, ctx) => runAskUserQuestion(input, ctx),
  },
];

export function defineInteractionTools(): ToolDefinition[] {
  return defineTools(INTERACTION_TOOL_SPECS);
}

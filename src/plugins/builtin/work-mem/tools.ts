import { isDeepModeEnabled } from "../../../agent/deep-mode.js";
import { defineTools, type ToolSpec } from "../../../tools/define-tool.js";
import type { ToolDefinition } from "../../../tools/types.js";
import { TOOL_NAMES } from "../../../tools/names.js";
import { runWorkMem } from "./handler.js";
import type { WorkMemAction } from "./types.js";

const WORK_MEM_DESCRIPTION_DEEP =
  "Deep Task Mode is active and required for this run. Maintain structured task state in work_mem: refine the seeded outline (draft/outline), record findings (note with ref), and before concluding write draft/decision. Use summarize/refine to pack jsonl when context grows. Do not store raw tool dumps; keep refs to evidence elsewhere.";

const WORK_MEM_TOOL_SPECS: ToolSpec[] = [
  {
    name: TOOL_NAMES.WORK_MEM,
    description: WORK_MEM_DESCRIPTION_DEEP,
    permission: { kind: "fixed", decision: "allow" },
    capability: "mixed",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["draft", "note", "summarize", "refine"],
          description: "Operation to perform on the active deep task work-mem file.",
        },
        kind: {
          type: "string",
          enum: ["outline", "hypothesis", "decision", "action"],
          description: "draft kind when action is draft.",
        },
        content: {
          type: "string",
          description: "Body text for draft or note.",
        },
        ref: {
          type: "string",
          description: "Optional reference (toolUseId, path, etc.) for note.",
        },
        max_chars: {
          type: "integer",
          description: "Optional character cap for summarize/refine pack.",
        },
        tier: {
          type: "string",
          enum: ["normal", "emergency"],
          description: "Pack tier for summarize (default normal). refine always uses compact.",
        },
        reason: {
          type: "string",
          description: "Optional reason when action is refine.",
        },
      },
      required: ["action"],
    },
    run: (input, ctx) =>
      runWorkMem(
        {
          action: String(input.action ?? "") as WorkMemAction,
          kind: input.kind !== undefined ? String(input.kind) : undefined,
          content: input.content !== undefined ? String(input.content) : undefined,
          ref: input.ref !== undefined ? String(input.ref) : undefined,
          max_chars:
            input.max_chars === undefined ? undefined : Number(input.max_chars),
          tier: input.tier !== undefined ? String(input.tier) : undefined,
          reason: input.reason !== undefined ? String(input.reason) : undefined,
        },
        { workdir: ctx.workdir, sessionId: ctx.sessionId },
      ),
  },
];

export function defineWorkMemTools(): ToolDefinition[] | null {
  if (!isDeepModeEnabled()) {
    return null;
  }
  return defineTools(WORK_MEM_TOOL_SPECS);
}

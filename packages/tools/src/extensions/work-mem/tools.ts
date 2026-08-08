import { getWorkMemToolPort } from "../../ports/work-mem-tool.js";
import { defineTools, type ToolSpec } from "../../define-tool.js";
import type { ToolDefinition } from "../../types.js";
import { TOOL_NAMES } from "../../names.js";
import { runWorkMem } from "./handler.js";
import type { WorkMemAction } from "./types.js";

const WORK_MEM_DESCRIPTION_DEEP =
  "Deep Task Mode is required. Structured state lives in work_mem and appears each turn in the Working Set (seeded outline already present). " +
  "Rhythm: (1) First, refine outline — action draft, kind outline. (2) While investigating, after meaningful reads/greps, action note with ref (file path or toolUseId). (3) Before your final reply, action draft kind decision; add kind action for follow-ups. " +
  "Draft kinds: outline (plan/questions), hypothesis (testable guesses), decision (conclusion), action (next steps). " +
  "Use summarize or refine only when notes pile up or the Working Set grows too large; do not store raw tool dumps.";

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
          description:
            "draft: append structured entry (requires kind + content). note: append finding after reads/greps (requires content; ref recommended). summarize: pack entries when notes pile up (optional tier normal/emergency). refine: compact pack when Working Set is too large.",
        },
        kind: {
          type: "string",
          enum: ["outline", "hypothesis", "decision", "action"],
          description:
            "Required when action is draft. outline: task plan and open questions. hypothesis: testable guess mid-investigation. decision: final conclusion. action: follow-up steps or deliverables.",
        },
        content: {
          type: "string",
          description: "Body text for draft or note. Keep concise; do not paste raw tool output.",
        },
        ref: {
          type: "string",
          description:
            "Evidence pointer for note — e.g. src/foo.ts or a toolUseId from the triggering read/grep.",
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
  if (!getWorkMemToolPort().isDeepModeEnabled()) {
    return null;
  }
  return defineTools(WORK_MEM_TOOL_SPECS);
}

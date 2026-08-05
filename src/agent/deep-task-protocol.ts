import type { ContentBlock } from "../llm/protocol/types.js";
import { TOOL_NAMES } from "../tools/names.js";

/** Deep Task Protocol reminder injected by harness (not user-authored). */
export type ProtocolReminderKind = "orient" | "synthesize";

export const ORIENT_PROTOCOL_REMINDER_TEXT =
  "[Deep Task — protocol reminder] Before other tools, update the task outline with work_mem (action draft, kind outline).";

export const SYNTHESIZE_PROTOCOL_REMINDER_TEXT =
  "[Deep Task — protocol reminder] Before concluding, record the decision with work_mem (action draft, kind decision).";

function toolUseBlocks(blocks: ContentBlock[]): Extract<ContentBlock, { type: "tool_use" }>[] {
  return blocks.filter(
    (block): block is Extract<ContentBlock, { type: "tool_use" }> => block.type === "tool_use",
  );
}

export function shouldSendOrientProtocolReminder(blocks: ContentBlock[]): boolean {
  const uses = toolUseBlocks(blocks);
  const usedWorkMem = uses.some((block) => block.name === TOOL_NAMES.WORK_MEM);
  const usedOther = uses.some((block) => block.name !== TOOL_NAMES.WORK_MEM);
  return usedOther && !usedWorkMem;
}

import type { InstructionState } from "./types.js";

export function buildSystemFromInstructionState(state: InstructionState): string {
  const parts = [state.basePrompt];
  if (state.projectRules?.trim()) {
    parts.push(state.projectRules.trim());
  }
  if (state.userMemory?.trim()) {
    parts.push(state.userMemory.trim());
  }
  return parts.join("\n\n");
}

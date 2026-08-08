/** Instruction State for system prompt assembly. See docs/spec/context-composer.md §6.1. */

export interface InstructionState {
  basePrompt: string;
  projectRules?: string;
  userMemory?: string;
  epoch: number;
}

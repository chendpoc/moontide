import { buildDefaultBasePrompt } from "../agent/prompt.js";
import { sha256UInt32Be } from "@moontide/shared/utils/hash.js";
import { loadProjectRules } from "./load.js";
import type { InstructionState } from "./types.js";

function instructionEpoch(projectRules: string): number {
  if (!projectRules) {
    return 1;
  }
  return sha256UInt32Be(projectRules);
}

let cachedWorkdir: string | undefined;
let cachedState: InstructionState | undefined;

export function resetInstructionStateCache(): void {
  cachedWorkdir = undefined;
  cachedState = undefined;
}

/** Single dependency surface for Instruction State (no file IO in consumers). */
export function resolveInstructionState(workdir: string): InstructionState {
  if (cachedWorkdir === workdir && cachedState) {
    return cachedState;
  }

  const projectRules = loadProjectRules(workdir);
  cachedState = {
    basePrompt: buildDefaultBasePrompt(workdir),
    projectRules: projectRules || undefined,
    epoch: instructionEpoch(projectRules),
  };
  cachedWorkdir = workdir;
  return cachedState;
}

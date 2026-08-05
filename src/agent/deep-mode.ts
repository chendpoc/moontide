import { randomBytes } from "node:crypto";

import { getWorkdir } from "../config.js";

import { getWorkMemAgentPorts } from "./ports/work-mem.js";

const DEEP_PREFIX = /^deep:\s*/i;

/** REPL-scoped Deep Task Mode (prompt `deep:` gate, not a slash command). */
let deepModeActive = false;

const activeWorkMemBySession = new Map<string, string>();
const activeGoalBySession = new Map<string, string>();

export function isDeepModeEnabled(): boolean {
  return deepModeActive;
}

export function getActiveWorkMemId(sessionId: string): string | undefined {
  return activeWorkMemBySession.get(sessionId);
}

function setDeepModeActive(active: boolean): void {
  deepModeActive = active;
}

export function getDeepTaskGoal(sessionId: string): string | undefined {
  return activeGoalBySession.get(sessionId);
}

export function resetDeepModeOnNewSession(): void {
  deepModeActive = false;
  activeWorkMemBySession.clear();
  activeGoalBySession.clear();
}

function generateWorkMemId(): string {
  return `wm_${randomBytes(4).toString("hex")}`;
}

export function startDeepTask(sessionId: string, goal: string): string {
  const workMemId = generateWorkMemId();
  const workdir = getWorkdir();
  getWorkMemAgentPorts().startDeepTaskRecord({ workdir, sessionId, workMemId, goal });
  setDeepModeActive(true);
  activeWorkMemBySession.set(sessionId, workMemId);
  activeGoalBySession.set(sessionId, goal);
  return workMemId;
}

export interface DeepPromptGateResult {
  prompt: string;
  deepActivated: boolean;
}

/** Strip `deep:` prefix, enable Deep Task Mode, and start a new work-mem task. */
export function applyDeepPromptGate(prompt: string, sessionId: string): DeepPromptGateResult {
  const trimmed = prompt.trim();
  if (!DEEP_PREFIX.test(trimmed)) {
    return { prompt, deepActivated: false };
  }
  const stripped = trimmed.replace(DEEP_PREFIX, "").trim();
  startDeepTask(sessionId, stripped);
  return { prompt: stripped, deepActivated: true };
}

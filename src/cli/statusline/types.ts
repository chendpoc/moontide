export type SessionPhase = "idle" | "running";

export interface StatusSnapshot {
  phase: SessionPhase;
  model: string;
  workdir: string;
  runId: string;
  turn: number | null;
  contextPct: number | null;
}

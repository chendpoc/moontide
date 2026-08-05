import { internalError } from "../../errors/factories.js";

export type WorkMemEscalationStagePort =
  | "normal"
  | "refined_at_normal"
  | "cap_upgraded"
  | "emergency";

export interface StartDeepTaskRecordInput {
  workdir: string;
  sessionId: string;
  workMemId: string;
  goal: string;
}

export interface ResolveWorkingSetPortInput {
  sessionId: string;
  workMemId: string;
  contextWindow: number;
  /** When set, never return an earlier escalation stage (e.g. compaction pressure → compact). */
  minStage?: WorkMemEscalationStagePort;
}

export interface ResolvedWorkingSetPort {
  text: string;
  stage: WorkMemEscalationStagePort;
  budgetTier: "normal" | "upgraded";
  truncated: boolean;
}

export interface WorkMemAgentPorts {
  startDeepTaskRecord(input: StartDeepTaskRecordInput): void;
  resolveWorkingSetSnapshot(input: ResolveWorkingSetPortInput): ResolvedWorkingSetPort;
  hasDecisionDraft(input: { sessionId: string; workMemId: string }): boolean;
}

let ports: WorkMemAgentPorts | undefined;

export function registerWorkMemAgentPorts(next: WorkMemAgentPorts): void {
  ports = next;
}

export function resetWorkMemAgentPorts(): void {
  ports = undefined;
}

export function getWorkMemAgentPorts(): WorkMemAgentPorts {
  if (!ports) {
    throw internalError("WorkMem agent ports are not registered");
  }
  return ports;
}

export function tryGetWorkMemAgentPorts(): WorkMemAgentPorts | undefined {
  return ports;
}

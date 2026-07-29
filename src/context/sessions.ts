import type { MessageParam, Tool } from "@anthropic-ai/sdk/resources/messages/messages.js";

import type { ContextReport, ContextSnapshot } from "./types.js";

interface SessionData {
  turn: number;
  messages: MessageParam[];
  system: string;
  tools: Tool[];
  latestReport?: ContextReport;
  previousEstimated?: number;
}

let session: SessionData = createEmptySession();

function createEmptySession(): SessionData {
  return {
    turn: 0,
    messages: [],
    system: "",
    tools: [],
    latestReport: undefined,
    previousEstimated: undefined,
  };
}

export function resetSession(): void {
  session = createEmptySession();
}

export function getSession(): SessionData {
  return session;
}

export function getLatestReport(): ContextReport | undefined {
  return session.latestReport;
}

export function updateSessionFromSnapshot(snapshot: ContextSnapshot, report: ContextReport): void {
  session = {
    turn: snapshot.turn,
    messages: snapshot.messages,
    system: snapshot.system,
    tools: snapshot.tools,
    latestReport: report,
    previousEstimated: report.estimatedTokens,
  };
}

export function updateLatestReport(report: ContextReport): void {
  session.latestReport = report;
}

export function getPreviousEstimated(): number | undefined {
  return session.previousEstimated;
}

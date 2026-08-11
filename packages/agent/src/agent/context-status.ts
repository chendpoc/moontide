import type { ComposedContext, ComposedLLMRequest, ContextManifest } from "@moontide/context-composer";
import type { ContextReport } from "../context-inspect/types.js";

interface RuntimeContextStatus {
  turn: number;
  lastManifest?: ContextManifest;
  lastComposedRequest?: ComposedLLMRequest;
  latestReport?: ContextReport;
  previousEstimated?: number;
}

let status: RuntimeContextStatus = createEmptyStatus();

function createEmptyStatus(): RuntimeContextStatus {
  return {
    turn: 0,
    lastManifest: undefined,
    lastComposedRequest: undefined,
    latestReport: undefined,
    previousEstimated: undefined,
  };
}

export function resetRuntimeStatus(): void {
  status = createEmptyStatus();
}

export function publishComposeResult(composed: ComposedContext): void {
  status.turn = composed.manifest.turn;
  status.lastManifest = composed.manifest;
  status.lastComposedRequest = composed.request as ComposedLLMRequest;
}

export function patchLastManifestDeepTask(
  patch: Partial<NonNullable<ContextManifest["deepTask"]>>,
): void {
  if (!status.lastManifest?.deepTask) {
    return;
  }
  status.lastManifest = {
    ...status.lastManifest,
    deepTask: {
      ...status.lastManifest.deepTask,
      ...patch,
    },
  };
}

export function getRuntimeTurn(): number {
  return status.latestReport?.turn ?? status.turn;
}

export function getLastComposedRequest(): ComposedLLMRequest | undefined {
  return status.lastComposedRequest;
}

export function getLastManifest(): ContextManifest | undefined {
  return status.lastManifest;
}

export function getLatestReport(): ContextReport | undefined {
  return status.latestReport;
}

export function publishContextReport(report: ContextReport): void {
  status.turn = report.turn;
  status.latestReport = report;
  status.previousEstimated = report.estimatedTokens;
}

export function updateLatestReport(report: ContextReport): void {
  status.latestReport = report;
}

export function getPreviousEstimated(): number | undefined {
  return status.previousEstimated;
}

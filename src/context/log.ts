import path from "node:path";

import {
  contextLogPath,
  contextSnapshotEnabled,
  getWorkdir,
} from "../config.js";
import { appendFs, mkdirFs, writeFs } from "../native-tools/fs-write.js";
import type { ContextReport, ContextSnapshot } from "./types.js";

function resolveLogPath(): string {
  const configured = contextLogPath();
  return path.isAbsolute(configured) ? configured : path.join(getWorkdir(), configured);
}

export function appendContextLog(report: ContextReport, snapshot?: ContextSnapshot): void {
  const logPath = resolveLogPath();
  mkdirFs(path.dirname(logPath));

  const entry = {
    turn: report.turn,
    ts: new Date().toISOString(),
    metrics: {
      estimatedTokens: report.estimatedTokens,
      exactTokens: report.exactTokens,
      limit: report.limit,
      headroom: report.headroom,
      percentUsed: report.percentUsed,
    },
    breakdown: report.breakdown,
    structure: report.structure,
    trend: report.trend,
    usage: report.usage,
    alerts: report.alerts,
  };

  appendFs(logPath, `${JSON.stringify(entry)}\n`);

  if (contextSnapshotEnabled() && snapshot) {
    const snapshotDir = path.join(path.dirname(logPath), "snapshots");
    mkdirFs(snapshotDir);
    writeFs(
      path.join(snapshotDir, `turn-${report.turn}.json`),
      JSON.stringify(
        {
          turn: snapshot.turn,
          modelId: snapshot.modelId,
          system: snapshot.system,
          tools: snapshot.tools,
          messages: snapshot.messages,
        },
        null,
        2,
      ),
    );
  }
}

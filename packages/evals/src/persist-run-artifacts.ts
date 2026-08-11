import fs from "node:fs";
import path from "node:path";

import { RUNS_DIR } from "@moontide/shared/constants/storage.js";
import { dataPath } from "@moontide/shared/utils/path.js";
import { sessionLogPath } from "@moontide/session";

import { debugLogPath } from "@moontide/agent";

export interface PersistRunArtifactsOptions {
  workdir: string;
  sessionId: string;
  runId?: string;
  artifactDir: string;
  label: string;
}

function _copyIfExists(source: string, dest: string): void {
  if (!fs.existsSync(source)) {
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(source, dest);
}

/** Copy session log, agent event log, and debug jsonl before workdir teardown. */
export function copyRunArtifacts(options: PersistRunArtifactsOptions): void {
  const { workdir, sessionId, runId, artifactDir, label } = options;
  const sessionsDir = path.join(artifactDir, "sessions");
  const runsDir = path.join(artifactDir, "runs");
  const debugDir = path.join(artifactDir, "debug");

  const sessionSource = sessionLogPath(workdir, sessionId);
  const sessionDest = path.join(sessionsDir, `${label}-${sessionId}.jsonl`);
  _copyIfExists(sessionSource, sessionDest);

  if (runId) {
    const activeRun = dataPath(workdir, RUNS_DIR, `${runId}.active.jsonl`);
    _copyIfExists(activeRun, path.join(runsDir, `${label}-${runId}.active.jsonl`));

    const debugSource = debugLogPath(workdir, runId);
    _copyIfExists(debugSource, path.join(debugDir, `${label}-${runId}.jsonl`));
  }
}

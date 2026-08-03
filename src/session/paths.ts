import {
  ARTIFACTS_DIR,
  SESSIONS_DIR,
} from "../constants/storage.js";
import { dataPath, joinPath } from "../utils/path.js";

export { dataDir, dataPath } from "../utils/path.js";

export function sessionsDir(workdir: string): string {
  return dataPath(workdir, SESSIONS_DIR);
}

export function sessionLogPath(workdir: string, sessionId: string): string {
  return joinPath(sessionsDir(workdir), `${sessionId}.jsonl`);
}

export function artifactsDir(workdir: string, sessionId: string): string {
  return dataPath(workdir, ARTIFACTS_DIR, sessionId);
}

export function artifactPath(workdir: string, sessionId: string, artifactId: string): string {
  return joinPath(artifactsDir(workdir, sessionId), artifactId);
}

export function compactionDir(workdir: string, sessionId: string): string {
  return joinPath(sessionsDir(workdir), sessionId, "compaction");
}

export function compactionRecordPath(
  workdir: string,
  sessionId: string,
  compactionRecordId: string,
): string {
  return joinPath(compactionDir(workdir, sessionId), `${compactionRecordId}.json`);
}

export function checkpointsDir(workdir: string, sessionId: string): string {
  return joinPath(sessionsDir(workdir), sessionId, "checkpoints");
}

export function checkpointPath(
  workdir: string,
  sessionId: string,
  checkpointId: string,
): string {
  return joinPath(checkpointsDir(workdir, sessionId), `${checkpointId}.json`);
}

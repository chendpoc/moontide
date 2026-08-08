import { internalError } from "@moontide/shared/errors/factories.js";

export interface WorkMemToolPort {
  isDeepModeEnabled(): boolean;
  getActiveWorkMemId(sessionId: string): string | undefined;
}

let workMemToolPort: WorkMemToolPort | undefined;

export function setWorkMemToolPort(next: WorkMemToolPort): void {
  workMemToolPort = next;
}

export function getWorkMemToolPort(): WorkMemToolPort {
  if (!workMemToolPort) {
    throw internalError("WorkMem tool port is not set");
  }
  return workMemToolPort;
}

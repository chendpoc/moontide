import { getWorkdir } from "@moontide/agent";
import { STATUS_FILE } from "@moontide/shared/constants/storage.js";
import { writeJsonPretty } from "@moontide/shared/storage/fs.js";
import { dataPath } from "@moontide/shared/utils/path.js";
import type { StatusSnapshot } from "./types.js";

export function statusJsonPath(): string {
  return dataPath(getWorkdir(), STATUS_FILE);
}

export function writeStatusJson(snapshot: StatusSnapshot): void {
  writeJsonPretty(statusJsonPath(), snapshot);
}

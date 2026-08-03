import { getWorkdir } from "../../config.js";
import { STATUS_FILE } from "../../constants/storage.js";
import { writeJsonPretty } from "../../storage/fs.js";
import { dataPath } from "../../utils/path.js";
import type { StatusSnapshot } from "./types.js";

export function statusJsonPath(): string {
  return dataPath(getWorkdir(), STATUS_FILE);
}

export function writeStatusJson(snapshot: StatusSnapshot): void {
  writeJsonPretty(statusJsonPath(), snapshot);
}

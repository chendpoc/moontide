import fs from "node:fs";
import path from "node:path";

import { getWorkdir } from "../../config.js";
import { DATA_DIR, STATUS_FILE } from "../../constants/storage.js";
import type { StatusSnapshot } from "./types.js";

export function statusJsonPath(): string {
  return path.join(getWorkdir(), DATA_DIR, STATUS_FILE);
}

export function writeStatusJson(snapshot: StatusSnapshot): void {
  const filePath = statusJsonPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

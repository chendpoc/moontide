import os from "node:os";

import { mkdtemp, removePath } from "./fs.js";
import { joinPath } from "./path.js";

export function createTmpDir(prefix = "ocula-"): string {
  return mkdtemp(joinPath(os.tmpdir(), prefix));
}

export function removeTmpDir(dir: string): void {
  removePath(dir, { recursive: true });
}

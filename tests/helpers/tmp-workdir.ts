import fs from "node:fs";
import os from "node:os";

import { joinPath } from "../../src/utils/path.js";

export function createTmpWorkdir(prefix = "ocula-"): string {
  return fs.mkdtempSync(joinPath(os.tmpdir(), prefix));
}

export function removeTmpWorkdir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

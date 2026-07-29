import path from "node:path";

import { venvPath } from "../../../config.js";

export function buildRuntimeEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  const venv = venvPath();
  if (venv) {
    const binDir = path.join(path.resolve(venv), "bin");
    env.PATH = `${binDir}${path.delimiter}${env.PATH ?? ""}`;
    env.VIRTUAL_ENV = path.resolve(venv);
  }
  return env;
}

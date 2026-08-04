import { venvPath } from "../../../../config.js";
import { joinPath, pathDelimiter, resolvePath } from "../../../../utils/path.js";

export function buildRuntimeEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  const venv = venvPath();
  if (venv) {
    const binDir = joinPath(resolvePath(venv), "bin");
    env.PATH = `${binDir}${pathDelimiter()}${env.PATH ?? ""}`;
    env.VIRTUAL_ENV = resolvePath(venv);
  }
  return env;
}

import { getToolsProductConfig } from "../../../ports/product-config.js";
import { joinPath, pathDelimiter, resolvePath } from "@moontide/shared/utils/path.js";

export function buildRuntimeEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  const venv = getToolsProductConfig().venvPath();
  if (venv) {
    const binDir = joinPath(resolvePath(venv), "bin");
    env.PATH = `${binDir}${pathDelimiter()}${env.PATH ?? ""}`;
    env.VIRTUAL_ENV = resolvePath(venv);
  }
  return env;
}

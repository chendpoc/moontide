import path from "node:path";

import { APP_ENV, ENV_PREFIX } from "@moontide/shared/constants/index.js";
import { findWorkspaceRoot, loadWorkspaceEnv } from "@moontide/agent/load-env";

export { findWorkspaceRoot };

/** Load workspace `.env` and apply CLI dev defaults (workdir when cwd is packages/agent-cli). */
export function loadBootstrapEnv(appRoot: string): { workspaceRoot: string } {
  const result = loadWorkspaceEnv(appRoot);
  const workspaceRoot = result.workspaceRoot;

  if (
    !process.env[`${ENV_PREFIX}${APP_ENV.WORKDIR}`]?.trim() &&
    appRoot === path.join(workspaceRoot, "packages", "agent-cli")
  ) {
    process.env[`${ENV_PREFIX}${APP_ENV.WORKDIR}`] = workspaceRoot;
  }

  return result;
}

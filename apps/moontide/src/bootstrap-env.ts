import { existsSync } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";

import { APP_ENV, ENV_PREFIX } from "@moontide/shared/constants/index.js";

/** Walk up from `start` until `pnpm-workspace.yaml` is found. */
export function findWorkspaceRoot(start: string): string {
  let dir = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return start;
    }
    dir = parent;
  }
}

/** Load `.env` from workspace root then app root; default workdir for dev cwd. */
export function loadBootstrapEnv(appRoot: string): { workspaceRoot: string } {
  const workspaceRoot = findWorkspaceRoot(appRoot);

  const envDirs =
    appRoot === workspaceRoot ? [appRoot] : [workspaceRoot, appRoot];

  for (const envDir of envDirs) {
    const envPath = path.join(envDir, ".env");
    if (existsSync(envPath)) {
      loadEnv({ path: envPath, override: true });
    }
  }

  if (
    !process.env[`${ENV_PREFIX}${APP_ENV.WORKDIR}`] &&
    appRoot === path.join(workspaceRoot, "apps", "moontide")
  ) {
    process.env[`${ENV_PREFIX}${APP_ENV.WORKDIR}`] = workspaceRoot;
  }

  return { workspaceRoot };
}

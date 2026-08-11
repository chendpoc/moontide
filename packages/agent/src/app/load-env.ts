import { existsSync } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";

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

/** Load `.env` from workspace root then `appRoot` when they differ. */
export function loadWorkspaceEnv(appRoot: string): { workspaceRoot: string } {
  const workspaceRoot = findWorkspaceRoot(appRoot);
  const envDirs = appRoot === workspaceRoot ? [appRoot] : [workspaceRoot, appRoot];

  for (const envDir of envDirs) {
    const envPath = path.join(envDir, ".env");
    if (existsSync(envPath)) {
      loadEnv({ path: envPath, override: true });
    }
  }

  return { workspaceRoot };
}

import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

import { getWorkdir } from "../config.js";
import { exists, readText, writeText, ensureDir } from "@moontide/shared/utils/fs.js";
import { dataPath } from "@moontide/shared/utils/path.js";

const CONFIG_FILE = "config.toml";

export function workspaceConfigPath(workdir = getWorkdir()): string {
  return dataPath(workdir, CONFIG_FILE);
}

export function readWorkspaceConfig(workdir = getWorkdir()): Record<string, unknown> {
  const path = workspaceConfigPath(workdir);
  if (!exists(path)) {
    return {};
  }
  try {
    return parseToml(readText(path)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function writeWorkspaceConfig(root: Record<string, unknown>, workdir = getWorkdir()): void {
  ensureDir(dataPath(workdir));
  writeText(workspaceConfigPath(workdir), `${stringifyToml(root)}\n`);
}

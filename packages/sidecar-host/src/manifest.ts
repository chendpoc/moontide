import { parse as parseToml } from "smol-toml";

import { exists, readText } from "@moontide/shared/utils/fs.js";
import { dataPath } from "@moontide/shared/utils/path.js";
import type { PluginManifest, PluginManifestEntry } from "./types.js";

const MANIFEST_JSON = "plugins.json";
const MANIFEST_TOML = "plugins.toml";

function normalizeEntry(raw: unknown): PluginManifestEntry | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const entry = raw as Partial<PluginManifestEntry>;
  if (!entry.id || !entry.kind || !entry.attach) {
    return undefined;
  }
  return entry as PluginManifestEntry;
}

function readManifestFile(filePath: string): PluginManifest {
  const raw = readText(filePath);
  if (filePath.endsWith(".json")) {
    const parsed = JSON.parse(raw) as PluginManifest;
    return { plugins: (parsed.plugins ?? []).map(normalizeEntry).filter(Boolean) as PluginManifestEntry[] };
  }

  const parsed = parseToml(raw) as { plugins?: unknown[] };
  return {
    plugins: (parsed.plugins ?? []).map(normalizeEntry).filter(Boolean) as PluginManifestEntry[],
  };
}

export function loadPluginManifest(workdir: string): PluginManifest {
  const jsonPath = dataPath(workdir, MANIFEST_JSON);
  if (exists(jsonPath)) {
    return readManifestFile(jsonPath);
  }

  const tomlPath = dataPath(workdir, MANIFEST_TOML);
  if (exists(tomlPath)) {
    return readManifestFile(tomlPath);
  }

  return { plugins: [] };
}

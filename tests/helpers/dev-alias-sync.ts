import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { repoPath } from "./source-scan.js";

export interface VitestAliasEntry {
  find: string;
  isRegex: boolean;
}

export function listTsconfigDevPathKeys(): string[] {
  const json = JSON.parse(readFileSync(repoPath("tsconfig.dev.json"), "utf8")) as {
    compilerOptions?: { paths?: Record<string, string[]> };
  };
  return Object.keys(json.compilerOptions?.paths ?? {}).sort();
}

export async function listVitestAliasEntries(): Promise<VitestAliasEntry[]> {
  const configUrl = pathToFileURL(repoPath("vitest.config.ts")).href;
  const mod = (await import(configUrl)) as {
    default?: { resolve?: { alias?: Array<{ find: string | RegExp }> } };
  };
  const aliases = mod.default?.resolve?.alias ?? [];
  return aliases.map((entry) => ({
    find: entry.find instanceof RegExp ? entry.find.source : entry.find,
    isRegex: entry.find instanceof RegExp,
  }));
}

/** Compare tsconfig.dev paths with vitest resolve.alias entry points. */
export function diffDevAndVitestAliases(
  tsconfigKeys: string[],
  vitestEntries: VitestAliasEntry[],
): { missingInVitest: string[]; missingInTsconfig: string[] } {
  const vitestExact = new Set(vitestEntries.filter((entry) => !entry.isRegex).map((entry) => entry.find));
  const hasSharedSubpathRegex = vitestEntries.some(
    (entry) => entry.isRegex && entry.find.includes("@moontide\\/shared\\/"),
  );

  const missingInVitest: string[] = [];
  for (const key of tsconfigKeys) {
    if (key.endsWith("/*")) {
      if (key.startsWith("@moontide/shared/") && !hasSharedSubpathRegex) {
        missingInVitest.push(key);
      }
      continue;
    }
    if (!vitestExact.has(key)) {
      missingInVitest.push(key);
    }
  }

  const missingInTsconfig: string[] = [];
  for (const entry of vitestEntries) {
    if (entry.isRegex) {
      continue;
    }
    if (!tsconfigKeys.includes(entry.find)) {
      missingInTsconfig.push(entry.find);
    }
  }

  return { missingInVitest, missingInTsconfig };
}

export function sharedWildcardPathCount(tsconfigKeys: string[]): number {
  return tsconfigKeys.filter((key) => key.startsWith("@moontide/shared/") && key.endsWith("/*")).length;
}

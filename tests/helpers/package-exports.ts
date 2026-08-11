import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { collectTsFiles, repoPath } from "./source-scan.js";

const MONOREPO_IMPORT = /from\s+["'](@moontide\/[^"']+)["']/g;

const SCAN_ROOTS = [
  repoPath("packages"),
  repoPath("packages/agent-cli/src"),
  repoPath("tests"),
];

export interface PackageExportMap {
  name: string;
  pkgDir: string;
  exports: Record<string, unknown>;
}

export function listMoontidePackages(): PackageExportMap[] {
  const packagesDir = repoPath("packages");
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const pkgDir = path.join(packagesDir, entry.name);
      const pkgJson = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8")) as {
        name: string;
        exports?: Record<string, unknown>;
      };
      return {
        name: pkgJson.name,
        pkgDir,
        exports: pkgJson.exports ?? {},
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function collectMoontideImportSpecifiers(): string[] {
  const specs = new Set<string>();
  for (const root of SCAN_ROOTS) {
    if (!existsSync(root)) {
      continue;
    }
    for (const file of collectTsFiles(root)) {
      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(MONOREPO_IMPORT)) {
        specs.add(match[1]);
      }
    }
  }
  return [...specs].sort();
}

export function exportImportTarget(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "import" in value) {
    const target = (value as { import?: unknown }).import;
    return typeof target === "string" ? target : null;
  }
  return null;
}

/** Split `@moontide/pkg/sub/path.js` → package name + subpath (`sub/path.js`). */
export function splitPackageSpecifier(specifier: string): { pkgName: string; subpath: string } | null {
  const match = /^(@moontide\/[^/]+)\/(.*)$/.exec(specifier);
  if (!match) {
    return null;
  }
  return { pkgName: match[1], subpath: match[2] };
}

/**
 * Resolve a subpath import against package exports (wildcard + exact).
 * Returns a path relative to the package root, e.g. `dist/utils/text.js`.
 */
export function resolvePackageSubpathExport(
  exports: Record<string, unknown>,
  subpath: string,
): string | null {
  const request = `./${subpath}`;

  const exact = exports[request];
  const exactTarget = exportImportTarget(exact);
  if (exactTarget) {
    return exactTarget;
  }

  for (const [exportKey, exportValue] of Object.entries(exports)) {
    if (!exportKey.endsWith("/*")) {
      continue;
    }
    const prefix = exportKey.slice(0, -1);
    if (!request.startsWith(prefix)) {
      continue;
    }
    const star = request.slice(prefix.length);
    const template = exportImportTarget(exportValue);
    if (!template?.includes("*")) {
      continue;
    }
    return template.replace("*", star);
  }

  return null;
}

export function packageDirForName(packages: PackageExportMap[], pkgName: string): string | null {
  return packages.find((pkg) => pkg.name === pkgName)?.pkgDir ?? null;
}

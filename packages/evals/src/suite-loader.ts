import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EVAL_CASE_CATEGORIES,
  FEATURE_SURFACES,
  type EvalBucket,
  type EvalCaseDefinition,
  type EvalGradingMode,
  type EvalSuiteFile,
} from "./types.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const GRADING_MODES: readonly EvalGradingMode[] = ["objective", "subjective"];
const WORKSPACE_DIR = "workspace";
const FIXTURES_DIR = "fixtures";

interface SuiteManifest {
  version?: string;
  tier?: string;
  categories?: Partial<
    Record<string, { bucket?: EvalBucket; description?: string }>
  >;
}

export function suitePath(relative: string): string {
  return path.join(packageRoot, "suites", relative);
}

function _readManifest(dir: string): SuiteManifest | undefined {
  const manifestPath = path.join(dir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return undefined;
  }
  return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as SuiteManifest;
}

function _isLegacySuiteFile(parsed: unknown): parsed is EvalSuiteFile {
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    "cases" in parsed &&
    Array.isArray((parsed as EvalSuiteFile).cases)
  );
}

function _validateCase(caseDef: EvalCaseDefinition, suitePathLabel: string): void {
  if (!caseDef.id || !caseDef.category || !caseDef.gradingMode) {
    throw new Error(`Invalid case in ${suitePathLabel}: missing id, category, or gradingMode`);
  }
  if (!EVAL_CASE_CATEGORIES.includes(caseDef.category)) {
    throw new Error(`Invalid category "${caseDef.category}" in case ${caseDef.id}`);
  }
  if (!GRADING_MODES.includes(caseDef.gradingMode)) {
    throw new Error(`Invalid gradingMode "${caseDef.gradingMode}" in case ${caseDef.id}`);
  }
  if (caseDef.gradingMode === "objective") {
    if (!caseDef.expectedChecks?.length) {
      throw new Error(`Objective case ${caseDef.id} must define expectedChecks`);
    }
  }
  if (caseDef.featureSurface?.length) {
    for (const surface of caseDef.featureSurface) {
      if (!FEATURE_SURFACES.includes(surface)) {
        throw new Error(`Invalid featureSurface "${surface}" in case ${caseDef.id}`);
      }
    }
  }
}

function _assertUniqueCaseIds(cases: EvalCaseDefinition[], suitePathLabel: string): void {
  const seen = new Set<string>();
  for (const caseDef of cases) {
    if (seen.has(caseDef.id)) {
      throw new Error(`Duplicate case id "${caseDef.id}" in ${suitePathLabel}`);
    }
    seen.add(caseDef.id);
  }
}

function _loadFixtureTree(rootDir: string): Record<string, string> {
  if (!fs.existsSync(rootDir)) {
    return {};
  }

  const files: Record<string, string> = {};

  const _walk = (currentDir: string, prefix: string): void => {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.name === "http") {
        continue;
      }
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        _walk(fullPath, relativePath);
        continue;
      }
      files[relativePath] = fs.readFileSync(fullPath, "utf8");
    }
  };

  _walk(rootDir, "");
  return files;
}

function _readCasesJsonl(categoryDir: string): Omit<EvalCaseDefinition, "setup">[] {
  const jsonlPath = path.join(categoryDir, "cases.jsonl");
  if (!fs.existsSync(jsonlPath)) {
    throw new Error(`Missing cases.jsonl in ${categoryDir}`);
  }
  const lines = fs
    .readFileSync(jsonlPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  return lines.map((line, index) => {
    try {
      return JSON.parse(line) as Omit<EvalCaseDefinition, "setup">;
    } catch {
      throw new Error(`Invalid JSON on line ${index + 1} of ${jsonlPath}`);
    }
  });
}

function _attachFixtureSetup(
  caseDef: Omit<EvalCaseDefinition, "setup">,
  categoryDir: string,
  sharedFiles: Record<string, string> | undefined,
): EvalCaseDefinition {
  let merged: EvalCaseDefinition;
  if (sharedFiles && Object.keys(sharedFiles).length > 0) {
    merged = { ...caseDef, setup: { files: sharedFiles } };
  } else {
    const caseFixtureDir = path.join(categoryDir, FIXTURES_DIR, caseDef.id);
    const files = _loadFixtureTree(caseFixtureDir);
    merged = Object.keys(files).length > 0 ? { ...caseDef, setup: { files } } : { ...caseDef };
  }

  const recordingsPath = path.join(categoryDir, FIXTURES_DIR, caseDef.id, "http", "recordings.json");
  if (fs.existsSync(recordingsPath)) {
    merged = { ...merged, httpFixturesPath: recordingsPath };
  }

  return merged;
}

function _resolveSuiteMeta(
  relativePath: string,
  manifest: SuiteManifest | undefined,
): Pick<EvalSuiteFile, "version" | "bucket"> {
  const category = path.basename(relativePath);
  const categoryMeta = manifest?.categories?.[category];
  return {
    version: manifest?.version ?? "2",
    bucket: categoryMeta?.bucket,
  };
}

function _loadCategoryDirectory(relativePath: string, fullPath: string): EvalSuiteFile {
  const versionRoot = path.dirname(fullPath);
  const manifest = _readManifest(versionRoot);
  const caseRows = _readCasesJsonl(fullPath);
  const workspaceDir = path.join(fullPath, WORKSPACE_DIR);
  const sharedFiles = fs.existsSync(workspaceDir)
    ? _loadFixtureTree(workspaceDir)
    : undefined;

  const cases = caseRows.map((caseDef) => {
    const merged = _attachFixtureSetup(caseDef, fullPath, sharedFiles);
    _validateCase(merged, fullPath);
    return merged;
  });
  _assertUniqueCaseIds(cases, fullPath);

  return {
    ..._resolveSuiteMeta(relativePath, manifest),
    cases,
  };
}

function _loadLegacySuiteFile(fullPath: string): EvalSuiteFile {
  const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8")) as EvalSuiteFile;
  if (!parsed.version || !Array.isArray(parsed.cases)) {
    throw new Error(`Invalid suite file: ${fullPath}`);
  }
  for (const caseDef of parsed.cases) {
    _validateCase(caseDef, fullPath);
  }
  _assertUniqueCaseIds(parsed.cases, fullPath);
  return parsed;
}

/** Load a suite: v2 category dir (`cases.jsonl` + fixtures) or legacy v1 JSON. */
export function loadSuite(relativePath: string): EvalSuiteFile {
  const fullPath = suitePath(relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Suite not found: ${fullPath}`);
  }

  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
    return _loadCategoryDirectory(relativePath, fullPath);
  }

  if (!relativePath.endsWith(".json")) {
    throw new Error(`Suite path must be a .json file or directory: ${relativePath}`);
  }

  const parsed: unknown = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  if (!_isLegacySuiteFile(parsed)) {
    throw new Error(`Unsupported suite file (expected legacy cases[]): ${fullPath}`);
  }
  return _loadLegacySuiteFile(fullPath);
}

/** List runnable suite paths under a version directory. */
export function listSuiteFiles(version = "v1"): string[] {
  const dir = suitePath(version);
  if (!fs.existsSync(dir)) {
    return [];
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const subdirs = entries
    .filter((entry) => entry.isDirectory())
    .filter((entry) => fs.existsSync(path.join(dir, entry.name, "cases.jsonl")))
    .map((entry) => `${version}/${entry.name}`)
    .sort();
  if (subdirs.length > 0) {
    return subdirs;
  }

  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".json") &&
        entry.name !== "manifest.json",
    )
    .map((entry) => `${version}/${entry.name}`)
    .sort();
}

/** Load all files under a fixture directory (for tests). */
export function loadFixtureTree(relativeFixtureDir: string): Record<string, string> {
  return _loadFixtureTree(suitePath(relativeFixtureDir));
}

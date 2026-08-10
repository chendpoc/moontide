import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { shouldFailMergeGate } from "../src/baseline.js";
import { formatCompareSummary } from "../src/summary.js";
import type { EvalReport } from "../src/types.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runsDir = path.join(packageRoot, "runs");

function _latestRunDir(baseDir: string): string | undefined {
  if (!fs.existsSync(baseDir)) {
    return undefined;
  }
  const entries = fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const fullPath = path.join(baseDir, entry.name);
      return { name: entry.name, mtime: fs.statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return entries[0] ? path.join(baseDir, entries[0].name) : undefined;
}

function _loadReport(runDir: string): EvalReport {
  const reportPath = path.join(runDir, "report.json");
  if (!fs.existsSync(reportPath)) {
    throw new Error(`No report.json in ${runDir}`);
  }
  return JSON.parse(fs.readFileSync(reportPath, "utf8")) as EvalReport;
}

function main(): void {
  const argPath = process.argv[2];
  const runDir = argPath ? path.resolve(argPath) : _latestRunDir(runsDir);
  if (!runDir) {
    process.stderr.write(`No runs under ${runsDir}\n`);
    process.exitCode = 1;
    return;
  }

  const report = _loadReport(runDir);
  process.stdout.write(`Run: ${path.basename(runDir)}\n`);
  process.stdout.write(`Artifacts: ${runDir}\n`);
  if (report.compare) {
    process.stdout.write(`\n${formatCompareSummary(report.compare)}\n`);
    process.stdout.write(
      `\nmerge-gate: ${shouldFailMergeGate(report.compare) ? "FAIL" : "PASS"}\n`,
    );
  } else {
    process.stdout.write(`Pairs: ${report.pairs.length} (no compare summary)\n`);
  }
}

main();

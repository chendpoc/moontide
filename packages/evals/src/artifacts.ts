import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type { EvalPairRecord, EvalReport } from "./types.js";

export function gitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** Local run dir stamp: `YYYY-MM-DD_HH-mm-ss_ssRR` (ss=厘秒, RR=随机). */
function _localRunDirStamp(date = new Date()): string {
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const datePart = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  const timePart = `${pad2(date.getHours())}-${pad2(date.getMinutes())}-${pad2(date.getSeconds())}`;
  const subSecond = `${pad2(Math.floor(date.getMilliseconds() / 10))}${Math.random().toString(36).slice(2, 4).padEnd(2, "0")}`;
  return `${datePart}_${timePart}_${subSecond}`;
}

export function createArtifactDir(baseDir: string): string {
  const id = _localRunDirStamp();
  const dir = path.join(baseDir, id);
  fs.mkdirSync(path.join(dir, "sessions"), { recursive: true });
  return dir;
}

export function writeEvalReport(artifactDir: string, report: EvalReport): void {
  fs.writeFileSync(path.join(artifactDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const pairsLines = report.pairs.map((pair) => JSON.stringify(pair)).join("\n");
  fs.writeFileSync(path.join(artifactDir, "pairs.jsonl"), `${pairsLines}\n`, "utf8");

  fs.writeFileSync(
    path.join(artifactDir, "manifest.json"),
    `${JSON.stringify(
      {
        suiteVersion: report.suiteVersion,
        gitSha: report.gitSha,
        model: report.model,
        provider: report.provider,
        compare: report.compare,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

/** Load pair records from a prior run (`pairs.jsonl`). */
export function readPairsJsonl(filePath: string): EvalPairRecord[] {
  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) {
    return [];
  }
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as EvalPairRecord);
}

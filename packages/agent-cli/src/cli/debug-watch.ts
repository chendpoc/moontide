import fs from "node:fs";

import { getWorkdir } from "@moontide/agent";
import { ensureDirForFile } from "@moontide/shared/storage/fs.js";
import { dataPath } from "@moontide/shared/utils/path.js";

export const DEBUG_WATCH_JQ_FILE = "debug-watch.jq";

/** jq -R -r filter shipped beside debug logs (one NDJSON line → header + record). */
export const DEBUG_WATCH_JQ_FILTER = [
  "fromjson? // empty | del(.ts, .runId)",
  "| \"┌─ DEBUG turn \\(.turn | tostring | if length < 2 then \"0\" + . else . end)  \\(.kind)\"",
  ", .",
  ", \"└────────────────────────────────\"",
].join("\n");

export function debugWatchJqPath(workdir = getWorkdir()): string {
  return dataPath(workdir, DEBUG_WATCH_JQ_FILE);
}

export function ensureDebugWatchJqFile(workdir = getWorkdir()): string {
  const path = debugWatchJqPath(workdir);
  ensureDirForFile(path);
  fs.writeFileSync(path, `${DEBUG_WATCH_JQ_FILTER}\n`, "utf8");
  return path;
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** Multi-line shell hint: tail + jq -f (readable, copy both lines). */
export function formatDebugWatchHintLines(logPath: string, workdir = getWorkdir()): string[] {
  const jqPath = ensureDebugWatchJqFile(workdir);
  return [
    "watch (new terminal · needs jq):",
    `tail -f ${shellSingleQuote(logPath)} \\`,
    `| jq -C -R -r -f ${shellSingleQuote(jqPath)}`,
  ];
}

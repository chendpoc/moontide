#!/usr/bin/env tsx
/**
 * Cursor CLI statusLine script — merges Cursor stdin payload with MoonTide .moontide/status.json.
 * Config: ~/.cursor/cli-config.json → statusLine.command
 */
import fs from "node:fs";
import path from "node:path";

import { loadStatusLineConfig } from "../src/config/status-line.js";
import { DATA_DIR, STATUS_FILE } from "../src/constants/storage.js";
import { snapshotToPayload } from "../src/cli/statusline/collect.js";
import { renderStatusSegments } from "../src/cli/statusline/segments.js";
import type { StatusSnapshot } from "../src/cli/statusline/types.js";

interface CursorStatusPayload {
  cwd?: string;
  model?: { display_name?: string; id?: string };
  context_window?: {
    used_percentage?: number | null;
    total_input_tokens?: number | null;
    context_window_size?: number | null;
  };
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

function loadMoonTideStatus(cwd: string): StatusSnapshot | null {
  const filePath = path.join(cwd, DATA_DIR, STATUS_FILE);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as StatusSnapshot;
  } catch {
    return null;
  }
}

function mergeSnapshot(
  cursor: CursorStatusPayload,
  status: StatusSnapshot | null,
  cwd: string,
): StatusSnapshot {
  const pct = cursor.context_window?.used_percentage ?? status?.contextPct ?? null;
  const used =
    cursor.context_window?.total_input_tokens ?? status?.contextUsed ?? null;
  const limit =
    cursor.context_window?.context_window_size ?? status?.contextLimit ?? null;

  if (status) {
    return {
      ...status,
      model: cursor.model?.display_name ?? cursor.model?.id ?? status.model,
      workdir: status.workdir || cwd,
      contextPct: pct,
      contextUsed: used,
      contextLimit: limit,
    };
  }

  return {
    phase: "idle",
    model: cursor.model?.display_name ?? cursor.model?.id ?? "unknown",
    workdir: cwd,
    runId: "",
    turn: null,
    contextPct: pct,
    contextUsed: used,
    contextLimit: limit,
    contextDelta: null,
    contextHasBaseline: false,
    lastApiIn: null,
    lastApiOut: null,
  };
}

async function main(): Promise<void> {
  const raw = await readStdin();
  const cursor = raw.trim() ? (JSON.parse(raw) as CursorStatusPayload) : {};
  const cwd = cursor.cwd ?? process.cwd();
  const status = loadMoonTideStatus(cwd);
  const snapshot = mergeSnapshot(cursor, status, cwd);
  const config = loadStatusLineConfig(cwd);
  const line = renderStatusSegments(snapshot, config.segments);
  process.stdout.write(`${line}\n`);
  void snapshotToPayload(snapshot, cwd);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});

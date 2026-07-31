#!/usr/bin/env tsx
/**
 * Cursor CLI statusLine script — merges Cursor stdin payload with Ocula .ocula/status.json.
 * Config: ~/.cursor/cli-config.json → statusLine.command
 */
import fs from "node:fs";
import path from "node:path";

import { DATA_DIR, STATUS_FILE } from "../src/constants/storage.js";
import { formatStatusLine } from "../src/cli/statusline/format.js";
import type { StatusSnapshot } from "../src/cli/statusline/types.js";

interface CursorStatusPayload {
  cwd?: string;
  model?: { display_name?: string; id?: string };
  context_window?: {
    used_percentage?: number | null;
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

function loadOculaStatus(cwd: string): StatusSnapshot | null {
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
  ocula: StatusSnapshot | null,
): StatusSnapshot {
  const cwd = cursor.cwd ?? process.cwd();
  const pct = cursor.context_window?.used_percentage ?? ocula?.contextPct ?? null;

  if (ocula) {
    return {
      ...ocula,
      model: cursor.model?.display_name ?? cursor.model?.id ?? ocula.model,
      workdir: ocula.workdir || cwd,
      contextPct: pct,
    };
  }

  return {
    phase: "idle",
    model: cursor.model?.display_name ?? cursor.model?.id ?? "unknown",
    workdir: cwd,
    runId: "",
    turn: null,
    contextPct: pct,
  };
}

async function main(): Promise<void> {
  const raw = await readStdin();
  const cursor = raw.trim() ? (JSON.parse(raw) as CursorStatusPayload) : {};
  const cwd = cursor.cwd ?? process.cwd();
  const ocula = loadOculaStatus(cwd);
  const snapshot = mergeSnapshot(cursor, ocula);
  const lines = formatStatusLine(snapshot);
  process.stdout.write(`${lines}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});

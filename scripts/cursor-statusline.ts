#!/usr/bin/env tsx
/**
 * Cursor CLI statusLine script — merges Cursor stdin payload with Oculeau .oculeau/status.json.
 * Config: ~/.cursor/cli-config.json → statusLine.command
 */
import fs from "node:fs";
import path from "node:path";

import { DATA_DIR } from "../src/config.js";
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

function loadOculeauStatus(cwd: string): StatusSnapshot | null {
  const filePath = path.join(cwd, DATA_DIR, "status.json");
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
  oculeau: StatusSnapshot | null,
): StatusSnapshot {
  const cwd = cursor.cwd ?? process.cwd();
  const pct = cursor.context_window?.used_percentage ?? oculeau?.contextPct ?? null;

  if (oculeau) {
    return {
      ...oculeau,
      model: cursor.model?.display_name ?? cursor.model?.id ?? oculeau.model,
      workdir: oculeau.workdir || cwd,
      contextPct: pct,
    };
  }

  return {
    phase: "idle",
    model: cursor.model?.display_name ?? cursor.model?.id ?? "unknown",
    workdir: cwd,
    turn: null,
    contextPct: pct,
  };
}

async function main(): Promise<void> {
  const raw = await readStdin();
  const cursor = raw.trim() ? (JSON.parse(raw) as CursorStatusPayload) : {};
  const cwd = cursor.cwd ?? process.cwd();
  const oculeau = loadOculeauStatus(cwd);
  const snapshot = mergeSnapshot(cursor, oculeau);
  const lines = formatStatusLine(snapshot);
  process.stdout.write(`${lines}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});

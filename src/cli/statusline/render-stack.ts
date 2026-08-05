import { loadStatusLineConfig } from "../../config/status-line.js";
import { setExternalStderrWriteHandler } from "../../terminal/pin.js";
import { writeStderr } from "../../terminal/write.js";
import { formatActivityLine } from "./activity.js";
import { resolveStatusLineFromConfig } from "./command-hook.js";
import { collectStatusSnapshot, snapshotToPayload } from "./collect.js";
import { writeStatusJson } from "./persist.js";
import { formatStatusLineVerbose } from "./format.js";

let lastStackKey = "";
let cachedCommandLine: string | null | undefined;
let cachedPayloadKey = "";
let stackLineCount = 0;
let stackPinned = false;

async function buildStatusLineText(): Promise<string> {
  const snapshot = collectStatusSnapshot();
  const config = loadStatusLineConfig();
  const payloadKey = JSON.stringify(snapshotToPayload(snapshot));

  if (config.command) {
    if (cachedPayloadKey !== payloadKey || cachedCommandLine === undefined) {
      cachedPayloadKey = payloadKey;
      cachedCommandLine = await resolveStatusLineFromConfig(snapshotToPayload(snapshot));
    }
    if (cachedCommandLine) {
      return cachedCommandLine;
    }
  }

  return formatStatusLineVerbose(snapshot);
}

function stackLines(statusLine: string): string[] {
  const activity = formatActivityLine();
  return activity ? [activity, statusLine] : [statusLine];
}

function stackKey(lines: string[]): string {
  return lines.join("\n");
}

function canPinStack(): boolean {
  return process.stderr.isTTY === true;
}

function writeStackLines(lines: string[]): void {
  if (!canPinStack()) {
    writeStderr(`${lines.join("\n")}\n`);
    stackPinned = false;
    stackLineCount = 0;
    return;
  }

  if (stackPinned && stackLineCount > 0) {
    writeStderr(`\x1b[${stackLineCount}A`);
  }

  for (const line of lines) {
    writeStderr(`\x1b[2K\r${line}\n`);
  }

  if (stackPinned && stackLineCount > lines.length) {
    const extra = stackLineCount - lines.length;
    for (let i = 0; i < extra; i++) {
      writeStderr("\x1b[2K\r\n");
    }
    writeStderr(`\x1b[${extra}A`);
  }

  stackLineCount = lines.length;
  stackPinned = true;
}

export function isStatusStackPinned(): boolean {
  return stackPinned;
}

/** Call before non-stack stderr output so cursor-up stays accurate. */
export function unpinStatusStack(): void {
  stackPinned = false;
  stackLineCount = 0;
}

export function invalidateStatusLineCommandCache(): void {
  cachedCommandLine = undefined;
  cachedPayloadKey = "";
}

export function resetStatusStackRender(): void {
  lastStackKey = "";
  unpinStatusStack();
  invalidateStatusLineCommandCache();
}

setExternalStderrWriteHandler(unpinStatusStack);

export async function renderStatusStackAsync(): Promise<void> {
  const snapshot = collectStatusSnapshot();
  writeStatusJson(snapshot);

  const statusLine = await buildStatusLineText();
  const lines = stackLines(statusLine);
  const key = stackKey(lines);

  if (key === lastStackKey) {
    return;
  }
  lastStackKey = key;

  writeStackLines(lines);
}

export function renderStatusStack(): void {
  void renderStatusStackAsync();
}

export function clearStatusStackCacheForTest(): void {
  resetStatusStackRender();
}

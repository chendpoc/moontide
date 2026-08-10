import fs from "node:fs";
import path from "node:path";

import { runHttpFetchNetwork, type HttpFetchInput, type HttpFetchResult } from "@moontide/tools";

export interface HttpRecording {
  url: string;
  method?: string;
  response: HttpFetchResult;
}

export interface HttpRecordingsFile {
  recordings: HttpRecording[];
}

let activeRecordings: HttpRecordingsFile | undefined;
let recordMode = false;
let recordTargetPath: string | undefined;

function _normalizeUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return rawUrl.trim();
  }
}

export function loadHttpRecordings(filePath: string): HttpRecordingsFile {
  if (!fs.existsSync(filePath)) {
    return { recordings: [] };
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as HttpRecordingsFile;
}

export function installEvalHttpFixtures(
  recordingsPath: string,
  options: { record?: boolean } = {},
): void {
  activeRecordings = loadHttpRecordings(recordingsPath);
  recordMode = options.record ?? false;
  recordTargetPath = recordingsPath;
}

export function clearEvalHttpFixtures(): void {
  activeRecordings = undefined;
  recordMode = false;
  recordTargetPath = undefined;
}

function _findRecording(url: string, method: string): HttpRecording | undefined {
  const normalized = _normalizeUrl(url);
  return activeRecordings?.recordings.find(
    (entry) =>
      _normalizeUrl(entry.url) === normalized &&
      (entry.method ?? "GET").toUpperCase() === method.toUpperCase(),
  );
}

function _appendRecording(recording: HttpRecording): void {
  if (!recordTargetPath || !activeRecordings) {
    return;
  }
  activeRecordings.recordings.push(recording);
  fs.mkdirSync(path.dirname(recordTargetPath), { recursive: true });
  fs.writeFileSync(
    recordTargetPath,
    `${JSON.stringify(activeRecordings, null, 2)}\n`,
    "utf8",
  );
}

/** Eval HTTP replay executor for setHttpFetchExecutor. */
export async function evalHttpFetchExecutor(input: HttpFetchInput): Promise<string> {
  if (!activeRecordings) {
    return runHttpFetchNetwork(input);
  }

  const method = String(input.method ?? "GET").toUpperCase();
  const url = String(input.url ?? "").trim();
  const match = _findRecording(url, method);

  if (match) {
    return JSON.stringify(match.response);
  }

  if (recordMode && recordTargetPath) {
    const raw = await runHttpFetchNetwork(input);
    const parsed = JSON.parse(raw) as HttpFetchResult;
    _appendRecording({ url, method, response: parsed });
    return raw;
  }

  return JSON.stringify({
    status: "error",
    url,
    error: `no HTTP fixture for ${method} ${url}`,
  } satisfies HttpFetchResult);
}

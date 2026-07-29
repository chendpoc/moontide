import { collectStatusSnapshot } from "./collect.js";
import { formatStatusLine } from "./format.js";
import { writeStatusJson } from "./persist.js";

let lastRendered = "";

/** Reset dedupe state (tests). */
export function resetStatusLineRender(): void {
  lastRendered = "";
}

export function renderStatusLine(): void {
  const snapshot = collectStatusSnapshot();
  writeStatusJson(snapshot);
  const line = formatStatusLine(snapshot);
  if (line === lastRendered) {
    return;
  }
  lastRendered = line;
  process.stderr.write(`${line}\n`);
}

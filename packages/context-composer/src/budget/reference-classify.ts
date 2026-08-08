import { ARTIFACT_FOOTNOTE_PREFIX, COMPACT_PLACEHOLDER_PREFIX } from "./estimate.js";

/** Tool result already spilled to ArtifactStore (C2 path). */
export function isSpilledToolResultBody(body: string): boolean {
  return body.includes(ARTIFACT_FOOTNOTE_PREFIX);
}

/** Prune compact placeholder (L3 reference, not spill). */
export function isCompactToolResultBody(body: string): boolean {
  return body.startsWith(COMPACT_PLACEHOLDER_PREFIX);
}

/** Counts toward L3 Reference — spilled summaries + compact placeholders only. */
export function isReferenceToolResultBody(body: string): boolean {
  return isSpilledToolResultBody(body) || isCompactToolResultBody(body);
}

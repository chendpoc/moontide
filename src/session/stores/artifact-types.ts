/** Artifact metadata. See docs/spec/context-composer.md §6.2. */

export interface Artifact {
  id: string;
  sessionId: string;
  toolUseId: string;
  contentType: "text" | "json" | "binary";
  path: string;
  byteCount: number;
  createdAt: string;
}

import type { SessionItem } from "./types.js";

export interface SessionItemCommitPort {
  onItemCommitted(item: SessionItem): Promise<void>;
  replaceAll(sessionId: string, items: SessionItem[]): Promise<void>;
}

export const noopSessionItemCommitPort: SessionItemCommitPort = {
  async onItemCommitted() {},
  async replaceAll() {},
};

import type { CompactionRecord } from "./compaction-types.js";

export interface CompactionRecordStore {
  get(sessionId: string, recordId: string): Promise<CompactionRecord | undefined>;
  list(sessionId: string): Promise<CompactionRecord[]>;
  save(record: CompactionRecord): Promise<void>;
}

export function createStubCompactionRecordStore(): CompactionRecordStore {
  return {
    async get() {
      return undefined;
    },
    async list() {
      return [];
    },
    async save() {
      throw new Error("CompactionRecordStore not implemented");
    },
  };
}

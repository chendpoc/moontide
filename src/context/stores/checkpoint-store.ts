import type { Checkpoint } from "./checkpoint-types.js";

export interface CheckpointStore {
  get(sessionId: string, checkpointId: string): Promise<Checkpoint | undefined>;
  list(sessionId: string): Promise<Checkpoint[]>;
  save(checkpoint: Checkpoint): Promise<void>;
}

export function createStubCheckpointStore(): CheckpointStore {
  return {
    async get() {
      return undefined;
    },
    async list() {
      return [];
    },
    async save() {
      throw new Error("CheckpointStore not implemented");
    },
  };
}

import { checkpointPath, checkpointsDir } from "../paths.js";
import { ensureDirForFile, readJson, writeJsonPretty } from "../../storage/fs.js";
import { listJsonRecords } from "../../storage/list-json.js";
import type { Checkpoint } from "./checkpoint-types.js";

export interface CheckpointStore {
  get(sessionId: string, checkpointId: string): Promise<Checkpoint | undefined>;
  list(sessionId: string): Promise<Checkpoint[]>;
  save(checkpoint: Checkpoint): Promise<void>;
}

export class FileCheckpointStore implements CheckpointStore {
  constructor(private readonly workdir: string) {}

  async get(sessionId: string, checkpointId: string): Promise<Checkpoint | undefined> {
    return readJson<Checkpoint>(checkpointPath(this.workdir, sessionId, checkpointId));
  }

  async list(sessionId: string): Promise<Checkpoint[]> {
    const checkpoints = listJsonRecords(checkpointsDir(this.workdir, sessionId), (filePath) =>
      readJson<Checkpoint>(filePath),
    );
    return checkpoints.sort((a, b) => a.createdAtTurn - b.createdAtTurn);
  }

  async save(checkpoint: Checkpoint): Promise<void> {
    const path = checkpointPath(this.workdir, checkpoint.sessionId, checkpoint.id);
    ensureDirForFile(path);
    writeJsonPretty(path, checkpoint);
  }
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

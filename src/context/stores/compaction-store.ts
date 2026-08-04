import { compactionDir, compactionSavePath } from "../../session/paths.js";
import { ensureDirForFile, readJson, writeJsonPretty } from "../../storage/fs.js";
import { listJsonRecords } from "../../storage/list-json.js";
import type { CompactionSave } from "./compaction-types.js";

export interface CompactionStore {
  get(sessionId: string, saveId: string): Promise<CompactionSave | undefined>;
  list(sessionId: string): Promise<CompactionSave[]>;
  save(save: CompactionSave): Promise<void>;
}

export class FileCompactionStore implements CompactionStore {
  constructor(private readonly workdir: string) {}

  async get(sessionId: string, saveId: string): Promise<CompactionSave | undefined> {
    return readJson<CompactionSave>(compactionSavePath(this.workdir, sessionId, saveId));
  }

  async list(sessionId: string): Promise<CompactionSave[]> {
    const saves = listJsonRecords(compactionDir(this.workdir, sessionId), (filePath) =>
      readJson<CompactionSave>(filePath),
    );
    return saves.sort((a, b) => a.createdAtTurn - b.createdAtTurn);
  }

  async save(save: CompactionSave): Promise<void> {
    const path = compactionSavePath(this.workdir, save.sessionId, save.id);
    ensureDirForFile(path);
    writeJsonPretty(path, save);
  }
}

export function createStubCompactionStore(): CompactionStore {
  return {
    async get() {
      return undefined;
    },
    async list() {
      return [];
    },
    async save() {
      throw new Error("CompactionStore not implemented");
    },
  };
}

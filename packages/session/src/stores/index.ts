export type { Artifact } from "./artifact-types.js";
export {
  createMemoryArtifactStore,
  createStubArtifactStore,
  FileArtifactStore,
  type ArtifactStore,
} from "./artifact-store.js";
export type {
  CompactionSave,
  StructuredPayload,
  SummaryPayload,
} from "./compaction-types.js";
export {
  createStubCompactionStore,
  FileCompactionStore,
  type CompactionStore,
} from "./compaction-store.js";
export type { Checkpoint } from "./checkpoint-types.js";
export {
  createStubCheckpointStore,
  FileCheckpointStore,
  type CheckpointStore,
} from "./checkpoint-store.js";

import {
  FileArtifactStore,
  type ArtifactStore,
} from "./artifact-store.js";
import {
  FileCompactionStore,
  type CompactionStore,
} from "./compaction-store.js";
import {
  FileCheckpointStore,
  type CheckpointStore,
} from "./checkpoint-store.js";

export interface SessionStores {
  artifacts: ArtifactStore;
  compaction: CompactionStore;
  checkpoints: CheckpointStore;
}

export function createSessionStores(workdir: string): SessionStores {
  return {
    artifacts: new FileArtifactStore(workdir),
    compaction: new FileCompactionStore(workdir),
    checkpoints: new FileCheckpointStore(workdir),
  };
}

export { maybeSpillToolResult, type SpilledToolResult, type SpillOptions } from "./spill-artifact.js";

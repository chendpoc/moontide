import type { Artifact } from "./artifact-types.js";

export interface ArtifactStore {
  get(sessionId: string, artifactId: string): Promise<Artifact | undefined>;
  put(artifact: Artifact): Promise<void>;
}

export function createStubArtifactStore(): ArtifactStore {
  return {
    async get() {
      return undefined;
    },
    async put() {
      throw new Error("ArtifactStore not implemented");
    },
  };
}

import { internalError } from "../../errors/factories.js";
import { artifactMetaPath } from "../paths.js";
import { ensureDirForFile, readJson, writeJsonPretty } from "../../storage/fs.js";
import type { Artifact } from "./artifact-types.js";

export interface ArtifactStore {
  get(sessionId: string, artifactId: string): Promise<Artifact | undefined>;
  put(artifact: Artifact): Promise<void>;
}

export class FileArtifactStore implements ArtifactStore {
  constructor(private readonly workdir: string) {}

  async get(sessionId: string, artifactId: string): Promise<Artifact | undefined> {
    return readJson<Artifact>(artifactMetaPath(this.workdir, sessionId, artifactId));
  }

  async put(artifact: Artifact): Promise<void> {
    const path = artifactMetaPath(this.workdir, artifact.sessionId, artifact.id);
    ensureDirForFile(path);
    writeJsonPretty(path, artifact);
  }
}

export function createStubArtifactStore(): ArtifactStore {
  return {
    async get() {
      return undefined;
    },
    async put() {
      throw internalError("ArtifactStore not implemented");
    },
  };
}

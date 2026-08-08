import {
  ACTIVE_EVENTS_SUFFIX,
  ARCHIVE_EVENTS_SUFFIX,
  MAX_ARCHIVE_BYTES,
  MAX_COMPLETED_RUNS,
  RUNS_DIR,
  SEALED_EVENTS_SUFFIX,
  SEGMENT_LIMIT_BYTES,
  TEMP_ARCHIVE_SUFFIX,
} from "@moontide/shared/constants/storage.js";
import { appendNdjsonLine, ensureDir } from "@moontide/shared/storage/fs.js";
import { gunzipBuffer, gzipBuffer } from "@moontide/shared/utils/compress.js";
import {
  closeFd,
  exists,
  fileSize,
  listDir,
  openAppend,
  readBytes,
  removeFile,
  renameFile,
  stat as fileStat,
  writeBytes,
} from "@moontide/shared/utils/fs.js";
import { dataPath, joinPath, resolvePath } from "@moontide/shared/utils/path.js";
import { escapeRegExp } from "@moontide/shared/utils/text.js";
import type { EventOutput } from "../event-hub.js";
import { serializePersistedEvent } from "../persist.js";
import type { AgentEvent } from "../types.js";

export interface JsonlWriterOptions {
  workdir?: string;
  segmentLimitBytes?: number;
  maxCompletedRuns?: number;
  maxArchiveBytes?: number;
  gzip?: (input: Buffer) => Buffer;
}

interface RunArchive {
  runId: string;
  files: string[];
  bytes: number;
  mtimeMs: number;
}

function activeRunId(fileName: string): string | null {
  return fileName.endsWith(ACTIVE_EVENTS_SUFFIX)
    ? fileName.slice(0, -ACTIVE_EVENTS_SUFFIX.length)
    : null;
}

function sealedRunId(fileName: string): string | null {
  const match = /^(.*)-\d{4}\.jsonl\.sealed$/.exec(fileName);
  return match?.[1] ?? null;
}

function archiveParts(fileName: string): { runId: string; index: number } | null {
  const match = /^(.*)-(\d{4})\.jsonl\.gz$/.exec(fileName);
  if (!match) {
    return null;
  }
  return {
    runId: match[1]!,
    index: Number(match[2]),
  };
}

export class JsonlWriter implements EventOutput {
  private readonly fixedWorkdir?: string;
  private readonly segmentLimitBytes: number;
  private readonly maxCompletedRuns: number;
  private readonly maxArchiveBytes: number;
  private readonly gzip: (input: Buffer) => Buffer;
  private readonly initializedRoots = new Set<string>();
  private readonly runRoots = new Map<string, string>();

  constructor(options: JsonlWriterOptions = {}) {
    this.fixedWorkdir = options.workdir ? resolvePath(options.workdir) : undefined;
    this.segmentLimitBytes = options.segmentLimitBytes ?? SEGMENT_LIMIT_BYTES;
    this.maxCompletedRuns = options.maxCompletedRuns ?? MAX_COMPLETED_RUNS;
    this.maxArchiveBytes = options.maxArchiveBytes ?? MAX_ARCHIVE_BYTES;
    this.gzip =
      options.gzip ??
      ((input) => gzipBuffer(input));

    this.ensureStorage(this.resolveWorkdir());
  }

  handle(event: AgentEvent): void {
    const runsDir = this.runsDirForEvent(event);
    const activePath = this.activePath(runsDir, event.runId);
    const serialized = serializePersistedEvent(event);
    const currentBytes = exists(activePath) ? fileSize(activePath) : 0;

    if (currentBytes > 0 && currentBytes + serialized.bytes > this.segmentLimitBytes) {
      this.sealActive(runsDir, event.runId, true);
    }

    appendNdjsonLine(activePath, serialized.line);
  }

  finalizeRun(runId: string): void {
    const runsDir = this.runRoots.get(runId) ?? this.ensureStorage(this.resolveWorkdir());
    this.sealActive(runsDir, runId, false);
    this.enforceRetention(runsDir);
    this.runRoots.delete(runId);
  }

  private resolveWorkdir(): string {
    return this.fixedWorkdir ?? process.cwd();
  }

  private ensureStorage(workdir: string): string {
    const resolved = resolvePath(workdir);
    const runsDir = dataPath(resolved, RUNS_DIR);
    if (this.initializedRoots.has(runsDir)) {
      return runsDir;
    }

    ensureDir(runsDir);
    this.recoverTemporaryFiles(runsDir);
    this.recoverSealedFiles(runsDir);
    this.recoverActiveFiles(runsDir);
    this.enforceRetention(runsDir);
    this.initializedRoots.add(runsDir);
    return runsDir;
  }

  private runsDirForEvent(event: AgentEvent): string {
    const existing = this.runRoots.get(event.runId);
    if (existing) {
      return existing;
    }
    const runsDir = this.ensureStorage(this.resolveWorkdir());
    this.runRoots.set(event.runId, runsDir);
    return runsDir;
  }

  private activePath(runsDir: string, runId: string): string {
    return joinPath(runsDir, `${runId}${ACTIVE_EVENTS_SUFFIX}`);
  }

  private nextSegmentIndex(runsDir: string, runId: string): number {
    const pattern = new RegExp(
      `^${escapeRegExp(runId)}-(\\d{4})\\.jsonl\\.(?:gz|sealed)$`,
    );
    let highest = 0;
    for (const fileName of listDir(runsDir)) {
      const match = pattern.exec(fileName);
      if (match) {
        highest = Math.max(highest, Number(match[1]));
      }
    }
    return highest + 1;
  }

  private segmentPaths(runsDir: string, runId: string, index: number) {
    const stem = `${runId}-${String(index).padStart(4, "0")}`;
    return {
      sealed: joinPath(runsDir, `${stem}${SEALED_EVENTS_SUFFIX}`),
      archive: joinPath(runsDir, `${stem}${ARCHIVE_EVENTS_SUFFIX}`),
      temp: joinPath(runsDir, `${stem}${TEMP_ARCHIVE_SUFFIX}`),
    };
  }

  private sealActive(runsDir: string, runId: string, recreateActive: boolean): void {
    const activePath = this.activePath(runsDir, runId);
    if (!exists(activePath)) {
      return;
    }
    if (fileSize(activePath) === 0) {
      removeFile(activePath);
      return;
    }

    const index = this.nextSegmentIndex(runsDir, runId);
    const paths = this.segmentPaths(runsDir, runId, index);
    renameFile(activePath, paths.sealed);
    if (recreateActive) {
      closeFd(openAppend(activePath));
    }

    try {
      this.compressSealed(paths.sealed, paths.temp, paths.archive);
    } catch {
      if (exists(paths.temp)) {
        removeFile(paths.temp);
      }
    }
  }

  private compressSealed(
    sealedPath: string,
    tempPath: string,
    archivePath: string,
  ): void {
    const compressed = this.gzip(readBytes(sealedPath));
    writeBytes(tempPath, compressed);
    renameFile(tempPath, archivePath);
    removeFile(sealedPath);
  }

  private recoverTemporaryFiles(runsDir: string): void {
    for (const fileName of listDir(runsDir)) {
      if (fileName.endsWith(TEMP_ARCHIVE_SUFFIX)) {
        removeFile(joinPath(runsDir, fileName));
      }
    }
  }

  private recoverSealedFiles(runsDir: string): void {
    for (const fileName of listDir(runsDir)) {
      if (!fileName.endsWith(SEALED_EVENTS_SUFFIX)) {
        continue;
      }

      const sealedPath = joinPath(runsDir, fileName);
      const archivePath = sealedPath.slice(0, -SEALED_EVENTS_SUFFIX.length) + ARCHIVE_EVENTS_SUFFIX;
      const tempPath = sealedPath.slice(0, -SEALED_EVENTS_SUFFIX.length) + TEMP_ARCHIVE_SUFFIX;

      if (exists(archivePath)) {
        try {
          gunzipBuffer(readBytes(archivePath));
          removeFile(sealedPath);
          continue;
        } catch {
          removeFile(archivePath);
        }
      }

      try {
        this.compressSealed(sealedPath, tempPath, archivePath);
      } catch {
        if (exists(tempPath)) {
          removeFile(tempPath);
        }
      }
    }
  }

  private recoverActiveFiles(runsDir: string): void {
    for (const fileName of listDir(runsDir)) {
      const runId = activeRunId(fileName);
      if (runId) {
        this.sealActive(runsDir, runId, false);
      }
    }
  }

  private enforceRetention(runsDir: string): void {
    const activeRuns = new Set<string>();
    const incompleteRuns = new Set<string>();
    const archives = new Map<string, RunArchive>();

    for (const fileName of listDir(runsDir)) {
      const activeId = activeRunId(fileName);
      if (activeId) {
        activeRuns.add(activeId);
        continue;
      }
      const sealedId = sealedRunId(fileName);
      if (sealedId) {
        incompleteRuns.add(sealedId);
        continue;
      }
      const parts = archiveParts(fileName);
      if (!parts) {
        continue;
      }

      const filePath = joinPath(runsDir, fileName);
      const entryStat = fileStat(filePath);
      const archive = archives.get(parts.runId) ?? {
        runId: parts.runId,
        files: [],
        bytes: 0,
        mtimeMs: 0,
      };
      archive.files.push(filePath);
      archive.bytes += entryStat.size;
      archive.mtimeMs = Math.max(archive.mtimeMs, entryStat.mtimeMs);
      archives.set(parts.runId, archive);
    }

    const completed = [...archives.values()]
      .filter(
        (archive) =>
          !activeRuns.has(archive.runId) && !incompleteRuns.has(archive.runId),
      )
      .sort((a, b) => a.mtimeMs - b.mtimeMs);
    let totalBytes = completed.reduce((sum, archive) => sum + archive.bytes, 0);

    while (
      completed.length > this.maxCompletedRuns ||
      totalBytes > this.maxArchiveBytes
    ) {
      const oldest = completed.shift();
      if (!oldest) {
        break;
      }
      for (const filePath of oldest.files) {
        removeFile(filePath);
      }
      totalBytes -= oldest.bytes;
    }
  }
}

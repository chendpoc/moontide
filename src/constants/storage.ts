/** Workspace-local Ocula data directory name. */
export const DATA_DIR = ".ocula";

export const RUNS_DIR = "runs";
export const STATUS_FILE = "status.json";
export const TMP_DIR = "tmp";

export const ACTIVE_EVENTS_SUFFIX = ".active.jsonl";
export const SEALED_EVENTS_SUFFIX = ".jsonl.sealed";
export const ARCHIVE_EVENTS_SUFFIX = ".jsonl.gz";
export const TEMP_ARCHIVE_SUFFIX = ".jsonl.gz.tmp";

export const SEGMENT_LIMIT_BYTES = 5 * 1024 * 1024;
export const MAX_COMPLETED_RUNS = 20;
export const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
export const GZIP_LEVEL = 2;
export const MAX_PERSISTED_EVENT_BYTES = 64 * 1024;

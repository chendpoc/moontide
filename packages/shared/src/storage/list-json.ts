import { exists, listDir } from "../utils/fs.js";
import { joinPath } from "../utils/path.js";

export function listJsonRecords<T>(
  dir: string,
  parse: (filePath: string) => T | undefined,
): T[] {
  if (!exists(dir)) {
    return [];
  }

  const records: T[] = [];
  for (const name of listDir(dir)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const record = parse(joinPath(dir, name));
    if (record) {
      records.push(record);
    }
  }
  return records;
}

import { gunzipSync, gzipSync } from "node:zlib";

import { GZIP_LEVEL } from "../constants/storage.js";

export function gzipBuffer(input: Buffer, level = GZIP_LEVEL): Buffer {
  return gzipSync(input, { level });
}

export function gunzipBuffer(input: Buffer): Buffer {
  return gunzipSync(input);
}

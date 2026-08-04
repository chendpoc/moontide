import fs from "node:fs";
import path from "node:path";

/*__VARS__*/

function preview(value: unknown, depth: number, maxDepth: number): unknown {
  if (depth >= maxDepth) {
    if (Array.isArray(value)) {
      return `[Array(${value.length})]`;
    }
    if (value !== null && typeof value === "object") {
      return `{${Object.keys(value as object).join(", ")}}`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => preview(item, depth + 1, maxDepth));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = preview(v, depth + 1, maxDepth);
    }
    return out;
  }
  return value;
}

const filePath = __VARS__.path as string;
const maxDepth = Number(__VARS__.max_depth ?? 2);
const raw = fs.readFileSync(filePath, "utf8");
const data = JSON.parse(raw) as unknown;
const keys =
  data !== null && typeof data === "object" && !Array.isArray(data)
    ? Object.keys(data as Record<string, unknown>)
    : [];
const result = {
  path: filePath,
  keys,
  preview: preview(data, 0, maxDepth),
};
console.log(JSON.stringify(result));

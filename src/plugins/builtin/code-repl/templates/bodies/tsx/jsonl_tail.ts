import fs from "node:fs";

/*__VARS__*/

const filePath = __VARS__.path as string;
const n = Math.max(1, Number(__VARS__.n ?? 10));
const raw = fs.readFileSync(filePath, "utf8");
const allLines = raw.split("\n").filter((line) => line.trim().length > 0);
const tail = allLines.slice(-n);
const lines: unknown[] = [];
const errors: { line: number; error: string }[] = [];

for (let i = 0; i < tail.length; i++) {
  const lineNum = allLines.length - tail.length + i + 1;
  try {
    lines.push(JSON.parse(tail[i]!) as unknown);
  } catch (error) {
    errors.push({
      line: lineNum,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

console.log(JSON.stringify({ path: filePath, n, lines, errors }));

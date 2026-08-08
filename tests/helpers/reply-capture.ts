import { setStderrWriterForTest } from "../../apps/moontide/src/terminal/write.js";

export function replyLines(run: () => void): string[] {
  const lines: string[] = [];
  setStderrWriterForTest((chunk) => {
    for (const line of chunk.split("\n")) {
      if (line.length > 0) {
        lines.push(line);
      }
    }
    return true;
  });
  try {
    run();
  } finally {
    setStderrWriterForTest(null);
  }
  return lines;
}

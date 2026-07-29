type WriteFn = (chunk: string) => boolean;

let writer: WriteFn = (chunk) => process.stderr.write(chunk);

export function writeStderr(chunk: string): void {
  writer(chunk);
}

export function writeStderrLine(line: string): void {
  writeStderr(line.endsWith("\n") ? line : `${line}\n`);
}

export function writeStderrBlock(text: string): void {
  writeStderr(text.endsWith("\n") ? text : `${text}\n`);
  writeStderr("\n");
}

export function setStderrWriterForTest(fn: WriteFn | null): void {
  writer = fn ?? ((chunk) => process.stderr.write(chunk));
}

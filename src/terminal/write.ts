type WriteFn = (chunk: string) => boolean;

let stderrWriter: WriteFn = (chunk) => process.stderr.write(chunk);
let stdoutWriter: WriteFn = (chunk) => process.stdout.write(chunk);

export function writeStderr(chunk: string): void {
  stderrWriter(chunk);
}

export function writeStderrLine(line: string): void {
  writeStderr(line.endsWith("\n") ? line : `${line}\n`);
}

export function writeStderrBlock(text: string): void {
  writeStderr(text.endsWith("\n") ? text : `${text}\n`);
  writeStderr("\n");
}

export function writeStdoutLine(line: string): void {
  stdoutWriter(line.endsWith("\n") ? line : `${line}\n`);
}

export function setStderrWriterForTest(fn: WriteFn | null): void {
  stderrWriter = fn ?? ((chunk) => process.stderr.write(chunk));
}

export function setStdoutWriterForTest(fn: WriteFn | null): void {
  stdoutWriter = fn ?? ((chunk) => process.stdout.write(chunk));
}

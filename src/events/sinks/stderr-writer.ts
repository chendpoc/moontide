type WriteFn = (chunk: string) => boolean;

let writeFn: WriteFn = (chunk) => process.stderr.write(chunk);

/** Replace stderr writer (tests). Pass null to restore default. */
export function setStderrWriterForTest(fn: WriteFn | null): void {
  writeFn = fn ?? ((chunk) => process.stderr.write(chunk));
}

/** Write a multi-line block atomically so concurrent channels cannot interleave. */
export function writeStderrBlock(block: string): void {
  const text = block.endsWith("\n") ? block : `${block}\n`;
  writeFn(text);
}

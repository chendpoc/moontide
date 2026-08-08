export function byteLengthUtf8(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

export function truncateUtf8(text: string, maxBytes: number): string {
  if (byteLengthUtf8(text) <= maxBytes) {
    return text;
  }

  const bytes = Buffer.from(text, "utf8");
  let end = Math.min(bytes.length, maxBytes);
  while (end > 0 && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) {
    end -= 1;
  }
  return bytes.subarray(0, end).toString("utf8");
}

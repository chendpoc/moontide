import { createHash } from "node:crypto";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function sha256UInt32Be(input: string): number {
  const hash = createHash("sha256").update(input).digest();
  return hash.readUInt32BE(0) || 1;
}

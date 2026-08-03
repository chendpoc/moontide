import { randomBytes, randomUUID } from "node:crypto";

/** Local timestamp segment for filesystem-safe ids: `YYYYMMDD-HHmmss`. */
export function formatIdTimestamp(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join("");
  const time = [pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join("");
  return `${date}-${time}`;
}

/** Filesystem-safe id: `YYYYMMDD-HHmmss-<8 hex>`. */
export function newTimestampedId(now = new Date()): string {
  return `${formatIdTimestamp(now)}-${randomBytes(4).toString("hex")}`;
}

/** UUID for Agent Event Log entries. */
export function newEventId(): string {
  return randomUUID();
}

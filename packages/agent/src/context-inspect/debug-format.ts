export interface DebugRecordBase {
  kind: string;
  turn: number;
}

export function formatDebugRecord(record: DebugRecordBase & Record<string, unknown>): string {
  const header = `DEBUG turn ${String(record.turn).padStart(2, "0")}  ${record.kind}`;
  const body = JSON.stringify(record, null, 2);
  const width = Math.min(72, Math.max(header.length + 4, 48));
  const top = `┌─ ${header} ${"─".repeat(Math.max(2, width - header.length - 4))}`;
  const bottom = `└${"─".repeat(width + 2)}┘`;
  return [top, body, bottom].join("\n");
}

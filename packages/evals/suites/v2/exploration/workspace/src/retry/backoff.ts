export function backoffMs(attempt: number) { return 2 ** attempt * 100; }

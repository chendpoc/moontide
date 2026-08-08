export const WORKING_SET_SYSTEM_HEADER = "## Working set (Deep Task Mode)";

export function appendWorkingSetToSystem(systemBase: string, snapshot?: string): string {
  if (!snapshot?.trim()) {
    return systemBase;
  }
  return `${systemBase}\n\n${WORKING_SET_SYSTEM_HEADER}\n\n${snapshot.trim()}`;
}

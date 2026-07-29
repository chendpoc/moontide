/** System-level deny patterns (blocklist → deny). */
export const SYSTEM_DENY_PATTERNS = [
  "rm -rf /",
  "sudo",
  "shutdown",
  "reboot",
  "mkfs",
  "dd if=",
];

/** Destructive hints (blocklist → ask). */
export const DESTRUCTIVE_ASK_PATTERNS = ["rm ", "> /etc/", "chmod 777"];

export function matchesSystemDeny(text: string): boolean {
  return SYSTEM_DENY_PATTERNS.some((pattern) => text.includes(pattern));
}

export function matchesDestructiveAsk(text: string): boolean {
  return DESTRUCTIVE_ASK_PATTERNS.some((hint) => text.includes(hint));
}

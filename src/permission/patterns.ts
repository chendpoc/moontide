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

/** Network fetch via bash (prefer http_fetch tool). */
export const NETWORK_ASK_PATTERNS = [/\bcurl\b/i, /\bwget\b/i];

/** Code search via bash (prefer grep tool). */
export const GREP_ASK_PATTERNS = [/\brg\b/, /\bgrep\b/];

export function matchesSystemDeny(text: string): boolean {
  return SYSTEM_DENY_PATTERNS.some((pattern) => text.includes(pattern));
}

export function matchesDestructiveAsk(text: string): boolean {
  return DESTRUCTIVE_ASK_PATTERNS.some((hint) => text.includes(hint));
}

export function matchesNetworkAsk(text: string): boolean {
  return NETWORK_ASK_PATTERNS.some((pattern) => pattern.test(text));
}

export function matchesGrepAsk(text: string): boolean {
  return GREP_ASK_PATTERNS.some((pattern) => pattern.test(text));
}

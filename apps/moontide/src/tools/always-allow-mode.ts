import { alwaysAllowDefault } from "../config.js";

let alwaysAllowOverride: boolean | null = null;

export function isAlwaysAllowEnabled(): boolean {
  if (alwaysAllowOverride !== null) {
    return alwaysAllowOverride;
  }
  return alwaysAllowDefault();
}

export function setAlwaysAllowOverride(value: boolean | null): void {
  alwaysAllowOverride = value;
}

export function resetAlwaysAllowOverride(): void {
  alwaysAllowOverride = null;
}

export function describeAlwaysAllow(): string {
  return isAlwaysAllowEnabled() ? "always allow: on" : "always allow: off";
}

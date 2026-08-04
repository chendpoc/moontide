import { globSync } from "glob";

export interface GlobFilesOptions {
  cwd: string;
  absolute?: boolean;
  nodir?: boolean;
}

export function globFiles(pattern: string, options: GlobFilesOptions): string[] {
  return globSync(pattern, {
    cwd: options.cwd,
    absolute: options.absolute,
    nodir: options.nodir,
  });
}

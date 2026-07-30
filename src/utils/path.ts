export function shortenHomePath(dirPath: string, home = process.env.HOME): string {
  if (home && dirPath.startsWith(home)) {
    return `~${dirPath.slice(home.length)}`;
  }
  return dirPath;
}

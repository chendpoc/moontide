import { mkdir, readdir, rm } from "node:fs/promises";

const dist = new URL("../dist/", import.meta.url);
await mkdir(dist, { recursive: true });
for (const entry of await readdir(dist)) {
  if (entry !== ".gitkeep") {
    await rm(new URL(entry, dist), { force: true, recursive: true });
  }
}

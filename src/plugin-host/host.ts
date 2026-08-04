import { writeStderrLine } from "../terminal/write.js";
import { resolvePath } from "../utils/path.js";
import { loadPluginManifest } from "./manifest.js";
import { SidecarBridge } from "./sidecar/bridge.js";
import type { AttachedPlugin, PluginManifestEntry } from "./types.js";

export class PluginHost {
  private readonly attached = new Map<string, AttachedPlugin>();

  async loadStartupPlugins(workdir: string): Promise<void> {
    const manifest = loadPluginManifest(workdir);
    for (const entry of manifest.plugins) {
      if (entry.attach !== "startup") {
        continue;
      }
      await this.attach(entry, workdir);
    }
  }

  async attach(entry: PluginManifestEntry, workdir: string): Promise<void> {
    if (entry.kind !== "sidecar") {
      writeStderrLine(`[plugin-host] skip unsupported kind "${entry.kind}" for ${entry.id}`);
      return;
    }
    if (!entry.entry) {
      throw new Error(`Sidecar plugin "${entry.id}" missing entry`);
    }
    if (this.attached.has(entry.id)) {
      return;
    }

    const bridge = new SidecarBridge(entry.id, workdir);
    const dispose = await bridge.connect(entry.entry, entry.transport ?? "in-process");
    this.attached.set(entry.id, {
      id: entry.id,
      kind: entry.kind,
      dispose: () => {
        dispose();
        bridge.disconnect();
      },
    });
    writeStderrLine(`[plugin-host] attached sidecar plugin "${entry.id}"`);
  }

  detach(pluginId: string): void {
    const attached = this.attached.get(pluginId);
    if (!attached) {
      return;
    }
    attached.dispose();
    this.attached.delete(pluginId);
  }

  shutdown(): void {
    for (const attached of this.attached.values()) {
      attached.dispose();
    }
    this.attached.clear();
  }

  listAttached(): readonly AttachedPlugin[] {
    return [...this.attached.values()];
  }
}

let host: PluginHost | null = null;

export function getPluginHost(): PluginHost {
  if (!host) {
    host = new PluginHost();
  }
  return host;
}

export function resetPluginHost(): void {
  host?.shutdown();
  host = null;
}

export async function bootstrapPlugins(workdir: string): Promise<void> {
  await getPluginHost().loadStartupPlugins(workdir);
}

export function resolvePluginEntry(workdir: string, entry: string): string {
  return resolvePath(workdir, entry);
}

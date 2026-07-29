import fs from "node:fs";
import path from "node:path";

import { eventsLogPath, getWorkdir } from "../../config.js";
import type { EventOutput } from "../bus.js";
import { enrichEvent } from "../enrich.js";
import type { AgentEvent } from "../types.js";

export class JsonlWriter implements EventOutput {
  private readonly filePath: string;

  constructor(configuredPath = eventsLogPath()) {
    this.filePath = path.isAbsolute(configuredPath)
      ? configuredPath
      : path.join(getWorkdir(), configuredPath);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  handle(event: AgentEvent): void {
    fs.appendFileSync(this.filePath, `${JSON.stringify(enrichEvent(event))}\n`, "utf8");
  }
}

import {
  composeTerminalBlock,
  formatTerminalEventBlock,
  resetTerminalRenderState,
} from "../format/terminal.js";
import { isObservabilityEnabled } from "../modes.js";
import type { EventOutput } from "../bus.js";
import type { AgentEvent } from "../types.js";
import { writeStderrBlock } from "../../terminal/write.js";

export class StderrRenderer implements EventOutput {
  handle(event: AgentEvent): void {
    if (!isObservabilityEnabled()) {
      return;
    }

    const block = formatTerminalEventBlock(event);
    if (!block) {
      return;
    }

    writeStderrBlock(composeTerminalBlock(event, block));
  }

  close(): void {
    resetTerminalRenderState();
  }
}

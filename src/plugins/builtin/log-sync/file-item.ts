import { getWorkdir } from "../../../config.js";
import { FileSessionItemWriter } from "../../../session/io/index.js";
import type { SessionItem } from "../../../session/types.js";

/** @deprecated Use FileSessionItemWriter or SessionItemCommitPort from Harness. */
export async function appendSessionItemToFile(
  item: SessionItem,
  workdir = getWorkdir(),
): Promise<void> {
  await new FileSessionItemWriter(workdir).append(item.sessionId, item);
}

/** @deprecated Use FileSessionItemWriter.replaceAll or SessionItemCommitPort. */
export async function replaceSessionItems(
  sessionId: string,
  items: SessionItem[],
  workdir = getWorkdir(),
): Promise<void> {
  await new FileSessionItemWriter(workdir).replaceAll(sessionId, items);
}

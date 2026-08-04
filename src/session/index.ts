export { Session } from "./session.js";
export { SessionTransform } from "./transform.js";
export { newSessionId } from "./ids.js";
export type {
  AssistantMessageItem,
  CheckpointCreatedItem,
  CompactionItem,
  CompactionKind,
  RoutingItem,
  SessionContext,
  SessionItem,
  SessionItemBase,
  SessionItemBody,
  SessionItemKind,
  SessionMessage,
  ToolInvocationItem,
  ToolOutcomeItem,
  ToolResultSummary,
  UserMessageItem,
  SessionLog,
  SessionLogBase,
  SessionLogBody,
  SessionLogKind,
  UserMessageLog,
  AssistantMessageLog,
  ToolInvocationLog,
  ToolOutcomeLog,
  CompactionEventLog,
  CheckpointCreatedLog,
  RoutingLog,
} from "./types.js";
export {
  isSessionItem,
  isNonMessageSessionItem,
  isSessionLog,
  NON_MESSAGE_ITEM_KINDS,
} from "./types.js";
export type {
  SessionItemReader,
  SessionItemReadOptions,
  SessionItemTailReader,
  SessionLogReader,
  SessionLogReadOptions,
  SessionLogTailReader,
} from "./io/reader.js";
export type { SessionItemWriter, SessionLogWriter } from "./io/writer.js";
export {
  buildSessionItem,
  buildSessionLog,
  FileSessionItemReader,
  FileSessionItemWriter,
  FileSessionLogReader,
  FileSessionLogWriter,
  parseItems,
} from "./io/index.js";
export {
  contextFromItems,
  itemsFromContext,
  itemsFromMessage,
  itemsFromMessages,
  messagesFromContext,
  messagesFromItems,
} from "./transform/index.js";
export type { MessagesFromContextOptions } from "./transform/messages-from-context.js";
export type { SaveSessionMode, SaveSessionOptions } from "./transform.js";
export { mapSdkContentBlocks, userMessageText, summarizeToolResultContent } from "./content-map.js";
export {
  artifactPath,
  artifactsDir,
  checkpointPath,
  checkpointsDir,
  compactionDir,
  compactionRecordPath,
  compactionSavePath,
  artifactMetaPath,
  dataDir,
  sessionLogPath,
  sessionsDir,
} from "./paths.js";

/** @deprecated Use SessionTransform */
export { SessionTransform as SessionLogSlice } from "./transform.js";

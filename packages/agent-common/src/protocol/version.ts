/** RunEvent / RunConfig protocol version. Breaking changes bump this integer. */
export const PROTOCOL_VERSION = 1 as const;

export type ProtocolVersion = typeof PROTOCOL_VERSION;

export interface SidecarHookSpec {
  phase: string;
  name: string;
  order?: number;
  errorPolicy?: "fail-open" | "fail-closed";
}

export interface SidecarToolSpec {
  name: string;
  schema: Record<string, unknown>;
}

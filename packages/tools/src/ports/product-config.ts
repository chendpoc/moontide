import { internalError } from "@moontide/shared/errors/factories.js";

export interface ToolsProductConfig {
  httpFetchEnabled(): boolean;
  codeReplDisabled(): boolean;
  codeReplDefaultRuntime(): string;
  codeReplTimeoutMs(): number;
  venvPath(): string | undefined;
  pythonPath(): string | undefined;
  deepResearchEnabled(): boolean;
  tavilyApiKey(): string | undefined;
}

let productConfig: ToolsProductConfig | undefined;

export function setToolsProductConfig(next: ToolsProductConfig): void {
  productConfig = next;
}

export function getToolsProductConfig(): ToolsProductConfig {
  if (!productConfig) {
    throw internalError("Tools product config is not set");
  }
  return productConfig;
}

export function tryGetToolsProductConfig(): ToolsProductConfig | undefined {
  return productConfig;
}

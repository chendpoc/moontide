import { estimateJsonTokens } from "@moontide/session/block-registry";

if (typeof estimateJsonTokens !== "function") {
  process.exit(2);
}

console.log("ok");

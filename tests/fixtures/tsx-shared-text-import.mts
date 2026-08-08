import { truncateOneLine } from "@moontide/shared/utils/text.js";

if (typeof truncateOneLine !== "function") {
  process.exit(2);
}

console.log("ok");

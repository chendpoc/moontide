await import("../../apps/moontide/src/bootstrap.js");
const { getWorkdir } = await import("../../apps/moontide/src/config.js");

console.log(getWorkdir());

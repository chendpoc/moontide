import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setWorkdir } from "../packages/agent/src/config.js";
import {
	setDebugOverride,
	resetDebugOverride,
} from "../packages/agent/src/context-inspect/debug-mode.js";
import {
	DEBUG_WATCH_JQ_FILTER,
	debugWatchJqPath,
	ensureDebugWatchJqFile,
	formatDebugWatchHintLines,
} from "../packages/agent-cli/src/cli/debug-watch.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";

describe("debug watch hint", () => {
	let tmpDir = "";
	let originalWorkdir = "";

	beforeEach(() => {
		originalWorkdir = tmpDir;
		tmpDir = createTmpWorkdir("moontide-debug-watch-");
		setWorkdir(tmpDir);
		resetDebugOverride();
	});

	afterEach(() => {
		resetDebugOverride();
		setWorkdir(originalWorkdir);
		removeTmpWorkdir(tmpDir);
	});

	it("writes jq filter file under workdir", () => {
		setDebugOverride("file");
		const path = ensureDebugWatchJqFile(tmpDir);
		expect(path).toBe(debugWatchJqPath(tmpDir));
		expect(fs.readFileSync(path, "utf8")).toBe(`${DEBUG_WATCH_JQ_FILTER}\n`);
	});

	it("formats multi-line tail and jq -f hint", () => {
		setDebugOverride("file");
		const logPath = `${tmpDir}/.moontide/debug/sid.jsonl`;
		const lines = formatDebugWatchHintLines(logPath, tmpDir);
		expect(lines).toEqual([
			"watch (new terminal · needs jq):",
			`tail -f '${logPath}' \\`,
			`| jq -C -R -r -f '${debugWatchJqPath(tmpDir)}'`,
		]);
		expect(lines.join("\n")).not.toContain("fromjson?");
	});
});

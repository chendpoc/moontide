import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyAgentEventOutputs, resetEventPlatform } from "@moontide/agent";
import { getOutputs, JsonlWriter } from "@moontide/agent/observability";
import { createCliEventOutputs } from "../packages/agent-cli/src/log/cli-event-outputs.js";

describe("event output setup", () => {
	beforeEach(() => {
		resetEventPlatform();
	});

	afterEach(() => {
		resetEventPlatform();
	});

	it("registers JsonlWriter via createCliEventOutputs", () => {
		applyAgentEventOutputs(createCliEventOutputs("/tmp/moontide-output-test"));
		const types = getOutputs().map((output) => output.constructor);
		expect(types).toEqual([JsonlWriter]);
	});
});

import { describe, expect, it } from "vitest";

import {
  evalHttpFetchExecutor,
  installEvalHttpFixtures,
  loadHttpRecordings,
} from "../src/http-fixtures.js";
import { suitePath } from "../src/suite-loader.js";

describe("http fixtures", () => {
  it("loads recordings file", () => {
    const path = suitePath("v2/external_research/fixtures/ext-moon-phase-fetch/http/recordings.json");
    const file = loadHttpRecordings(path);
    expect(file.recordings).toHaveLength(1);
  });

  it("replays fixture URL without network", async () => {
    const path = suitePath("v2/external_research/fixtures/ext-moon-phase-fetch/http/recordings.json");
    installEvalHttpFixtures(path);
    const raw = await evalHttpFetchExecutor({
      url: "https://registry.npmmirror.com/typescript/latest",
      method: "GET",
    });
    const parsed = JSON.parse(raw) as { body?: string; status: string };
    expect(parsed.status).toBe("ok");
    expect(parsed.body).toContain("Apache-2.0");
  });

  it("returns error when fixture missing", async () => {
    const path = suitePath("v2/external_research/fixtures/ext-moon-phase-fetch/http/recordings.json");
    installEvalHttpFixtures(path);
    const raw = await evalHttpFetchExecutor({
      url: "https://registry.npmmirror.com/unknown-package/latest",
      method: "GET",
    });
    const parsed = JSON.parse(raw) as { status: string; error?: string };
    expect(parsed.status).toBe("error");
    expect(parsed.error).toContain("no HTTP fixture");
  });
});

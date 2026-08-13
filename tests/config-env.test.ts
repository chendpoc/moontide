import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { alwaysAllowDefault, appEnv, debugModeDefault, isDevEnv } from "../packages/agent/src/config.js";

beforeEach(() => {
  vi.stubEnv("MOONTIDE_ENV", "");
  delete process.env.MOONTIDE_ENV;
  delete process.env.MOONTIDE_ALWAYS_ALLOW;
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.MOONTIDE_ENV;
  delete process.env.MOONTIDE_ALWAYS_ALLOW;
});

describe("appEnv", () => {
  it("defaults to production when unset", () => {
    expect(appEnv()).toBe("production");
    expect(isDevEnv()).toBe(false);
  });

  it("recognizes dev aliases", () => {
    vi.stubEnv("MOONTIDE_ENV", "dev");
    expect(appEnv()).toBe("dev");
    expect(isDevEnv()).toBe(true);

    vi.stubEnv("MOONTIDE_ENV", "development");
    expect(appEnv()).toBe("dev");
  });

  it("recognizes production aliases", () => {
    vi.stubEnv("MOONTIDE_ENV", "production");
    expect(appEnv()).toBe("production");

    vi.stubEnv("MOONTIDE_ENV", "prod");
    expect(appEnv()).toBe("production");
  });

  it("treats unknown values as production", () => {
    vi.stubEnv("MOONTIDE_ENV", "staging");
    expect(appEnv()).toBe("production");
  });
});

describe("alwaysAllowDefault", () => {
  it("is off in production when unset", () => {
    expect(alwaysAllowDefault()).toBe(false);
  });

  it("is on in dev when unset", () => {
    vi.stubEnv("MOONTIDE_ENV", "dev");
    expect(alwaysAllowDefault()).toBe(true);
  });

  it("honors explicit MOONTIDE_ALWAYS_ALLOW=1 in production", () => {
    vi.stubEnv("MOONTIDE_ALWAYS_ALLOW", "1");
    expect(alwaysAllowDefault()).toBe(true);
  });

  it("honors explicit MOONTIDE_ALWAYS_ALLOW=0 in dev", () => {
    vi.stubEnv("MOONTIDE_ENV", "dev");
    vi.stubEnv("MOONTIDE_ALWAYS_ALLOW", "0");
    expect(alwaysAllowDefault()).toBe(false);
  });
});

describe("debugModeDefault", () => {
  beforeEach(() => {
    delete process.env.MOONTIDE_DEBUG;
    delete process.env.MOONTIDE_ENV;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.MOONTIDE_DEBUG;
    delete process.env.MOONTIDE_ENV;
  });

  it("is off in production when unset", () => {
    expect(debugModeDefault()).toBe("off");
  });

  it("is file in dev when unset", () => {
    vi.stubEnv("MOONTIDE_ENV", "dev");
    expect(debugModeDefault()).toBe("file");
  });

  it("honors explicit MOONTIDE_DEBUG=off in dev", () => {
    vi.stubEnv("MOONTIDE_ENV", "dev");
    vi.stubEnv("MOONTIDE_DEBUG", "off");
    expect(debugModeDefault()).toBe("off");
  });

  it("maps legacy on/terminal env values to file", () => {
    vi.stubEnv("MOONTIDE_DEBUG", "on");
    expect(debugModeDefault()).toBe("file");
    vi.stubEnv("MOONTIDE_DEBUG", "terminal");
    expect(debugModeDefault()).toBe("file");
  });
});

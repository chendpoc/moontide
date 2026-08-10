import { describe, expect, it } from "vitest";

import { runConcurrent } from "../src/concurrency.js";

describe("runConcurrent", () => {
  it("preserves order with concurrency > 1", async () => {
    const tasks = [0, 1, 2, 3, 4].map(
      (value) => () =>
        new Promise<number>((resolve) => {
          setTimeout(() => resolve(value), (4 - value) * 5);
        }),
    );
    const results = await runConcurrent(tasks, 3);
    expect(results).toEqual([0, 1, 2, 3, 4]);
  });

  it("caps workers to task count", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const tasks = [1, 2, 3].map(
      () => () =>
        new Promise<number>((resolve) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          setTimeout(() => {
            inFlight -= 1;
            resolve(1);
          }, 10);
        }),
    );
    await runConcurrent(tasks, 10);
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });
});

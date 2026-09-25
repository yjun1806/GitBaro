import { describe, expect, it } from "vitest";
import { createConcurrencyLimit } from "../concurrency-limit";

describe("createConcurrencyLimit", () => {
  it("runs at most N tasks at once and starts the rest as slots free up", async () => {
    const limit = createConcurrencyLimit(2);
    let running = 0;
    let peak = 0;
    const releases: (() => void)[] = [];
    const task = () =>
      limit(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise<void>((resolve) => releases.push(resolve));
        running -= 1;
        return running;
      });
    const all = Promise.all([task(), task(), task(), task(), task()]);
    await Promise.resolve();
    expect(running).toBe(2);
    while (releases.length > 0 || running > 0) {
      releases.shift()?.();
      await new Promise((r) => setTimeout(r, 0));
    }
    await all;
    expect(peak).toBe(2);
  });

  it("frees the slot when a task fails", async () => {
    const limit = createConcurrencyLimit(1);
    await expect(limit(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(limit(() => Promise.resolve(42))).resolves.toBe(42);
  });
});

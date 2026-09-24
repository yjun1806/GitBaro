import { describe, expect, it, vi } from "vitest";
import { createBatchLoader } from "@/lib/batch-loader";

describe("createBatchLoader", () => {
  it("asks once for keys requested together, per group", async () => {
    const fetchMany = vi.fn(async (group: string, keys: string[]) => new Map(keys.map((k) => [k, `${group}:${k}`])));
    const load = createBatchLoader(fetchMany, 60);

    const results = await Promise.all([load("/a", "x"), load("/a", "y"), load("/a", "x"), load("/b", "z")]);

    expect(results).toEqual(["/a:x", "/a:y", "/a:x", "/b:z"]);
    expect(fetchMany).toHaveBeenCalledTimes(2);
    expect(fetchMany).toHaveBeenCalledWith("/a", ["x", "y"]);
    expect(fetchMany).toHaveBeenCalledWith("/b", ["z"]);
  });

  it("splits a large request into chunks of maxBatch", async () => {
    const fetchMany = vi.fn(async (_group: string, keys: string[]) => new Map(keys.map((k) => [k, k.length])));
    const load = createBatchLoader(fetchMany, 2);

    await Promise.all(["a", "b", "c", "d", "e"].map((k) => load("/r", k)));

    expect(fetchMany.mock.calls.map((c) => c[1])).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  });

  it("returns undefined for keys missing from the answer and passes errors on", async () => {
    const load = createBatchLoader(async () => new Map<string, number>(), 10);
    await expect(load("/r", "gone")).resolves.toBeUndefined();

    const failing = createBatchLoader<number>(async () => {
      throw new Error("boom");
    }, 10);
    await expect(Promise.all([failing("/r", "a"), failing("/r", "b")])).rejects.toThrow("boom");
  });

  it("starts a new batch for requests made after the previous one was sent", async () => {
    const fetchMany = vi.fn(async (_group: string, keys: string[]) => new Map(keys.map((k) => [k, k])));
    const load = createBatchLoader(fetchMany, 10);
    await load("/r", "a");
    await load("/r", "b");
    expect(fetchMany).toHaveBeenCalledTimes(2);
  });
});

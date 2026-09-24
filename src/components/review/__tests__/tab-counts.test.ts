import { describe, expect, it } from "vitest";
import { activeRunCount, badgeCount, changedFileCount, sumCounts } from "../tab-counts";

const committed = (...paths: string[]) => ({ committed: paths.map((path) => ({ path })) }) as never;

describe("badgeCount", () => {
  it("shows no badge for zero or unknown", () => {
    expect(badgeCount(0)).toBeUndefined();
    expect(badgeCount(null)).toBeUndefined();
    expect(badgeCount(undefined)).toBeUndefined();
  });

  it("passes a positive count through", () => {
    expect(badgeCount(3)).toBe(3);
  });
});

describe("changedFileCount", () => {
  it("is unknown until either side is loaded", () => {
    expect(changedFileCount(undefined, undefined)).toBeNull();
  });

  it("counts committed and uncommitted files together, once per path", () => {
    // a.ts는 커밋한 뒤 다시 고쳤고, b.ts는 스테이징·작업 트리 두 행으로 온다.
    const status = [{ path: "a.ts" }, { path: "b.ts" }, { path: "b.ts" }];
    expect(changedFileCount(committed("a.ts", "c.ts"), status)).toBe(3);
  });

  it("uses only the side it knows", () => {
    expect(changedFileCount(committed("a.ts"), undefined)).toBe(1);
    expect(changedFileCount(undefined, [{ path: "x" }])).toBe(1);
    expect(changedFileCount(committed(), [])).toBe(0);
  });
});

describe("sumCounts", () => {
  it("adds the known counts and ignores unknown ones", () => {
    expect(sumCounts([2, null, 3])).toBe(5);
  });

  it("is unknown when nothing is known", () => {
    expect(sumCounts([null, null])).toBeNull();
    expect(sumCounts([])).toBeNull();
  });
});

describe("activeRunCount", () => {
  it("counts runs that are running or waiting, not finished ones", () => {
    expect(
      activeRunCount([{ status: "in_progress" }, { status: "queued" }, { status: "completed" }]),
    ).toBe(2);
  });
});

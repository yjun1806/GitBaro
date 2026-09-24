import { describe, expect, it } from "vitest";
import { mergeHistories } from "../worktree-history";

const c = (id: string, timestamp: number) => ({ id, timestamp });

describe("mergeHistories", () => {
  it("returns the base unchanged when there is nothing to add", () => {
    const base = [c("a", 3), c("b", 2)];
    expect(mergeHistories(base, [[]], true)).toEqual(base);
  });

  it("interleaves another worktree's commits by time and keeps shared commits once", () => {
    const base = [c("m2", 50), c("m1", 30), c("root", 10)];
    const feat = [c("f2", 60), c("f1", 40), c("m1", 30), c("root", 10)];
    expect(mergeHistories(base, [feat], true).map((x) => x.id)).toEqual(["f2", "m2", "f1", "m1", "root"]);
  });

  it("keeps each history's own order even when its timestamps are out of order", () => {
    // Clock skew: child f2 is older than its parent f1. The parent must still come after it.
    const base = [c("m1", 50)];
    const feat = [c("f2", 20), c("f1", 40)];
    expect(mergeHistories(base, [feat], true).map((x) => x.id)).toEqual(["m1", "f2", "f1"]);
  });

  it("puts the base first on equal timestamps", () => {
    expect(mergeHistories([c("m", 5)], [[c("f", 5)]], true).map((x) => x.id)).toEqual(["m", "f"]);
  });

  it("drops commits older than the base's last loaded commit while more base pages remain", () => {
    const base = [c("m2", 50), c("m1", 30)];
    const feat = [c("f2", 60), c("f1", 20)];
    expect(mergeHistories(base, [feat], false).map((x) => x.id)).toEqual(["f2", "m2", "m1"]);
    expect(mergeHistories(base, [feat], true).map((x) => x.id)).toEqual(["f2", "m2", "m1", "f1"]);
  });
});

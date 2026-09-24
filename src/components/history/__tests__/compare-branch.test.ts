import { describe, expect, it } from "vitest";
import { isStaleCompareBranch } from "@/components/history/compare-branch";
import type { BranchInfo } from "@/types";

function branch(name: string, isRemote = false): BranchInfo {
  return {
    name,
    isHead: name === "main",
    isRemote,
    isDefault: name === "main",
    upstream: null,
    aheadBehind: null,
    lastCommitTime: null,
    isFullyMerged: false,
    lastCommitAuthor: null,
  };
}

describe("isStaleCompareBranch", () => {
  it("flags a compare branch that was deleted", () => {
    expect(isStaleCompareBranch("feature", [branch("main")])).toBe(true);
  });

  it("keeps a compare branch that still exists, local or remote", () => {
    expect(isStaleCompareBranch("feature", [branch("main"), branch("feature")])).toBe(false);
    expect(
      isStaleCompareBranch("origin/feature", [branch("main"), branch("origin/feature", true)]),
    ).toBe(false);
  });

  it("does nothing while branches are loading or nothing is compared", () => {
    expect(isStaleCompareBranch("feature", undefined)).toBe(false);
    expect(isStaleCompareBranch(null, [branch("main")])).toBe(false);
  });
});

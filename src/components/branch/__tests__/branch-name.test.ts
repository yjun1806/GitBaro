import { describe, expect, it } from "vitest";
import type { BranchInfo } from "@/types";
import { checkNewBranchName } from "../branch-name";

const branch = (name: string, isRemote = false) => ({ name, isRemote }) as BranchInfo;
const branches = [branch("main"), branch("feature/a"), branch("origin/remote-only", true)];

describe("checkNewBranchName", () => {
  it("accepts a new, well-formed name", () => {
    expect(checkNewBranchName("feature/b", branches)).toBeNull();
  });

  it("rejects a name that is already a local branch", () => {
    expect(checkNewBranchName("feature/a", branches)).toBe("exists");
  });

  it("does not treat a remote branch as a clash", () => {
    expect(checkNewBranchName("origin/remote-only", branches)).toBeNull();
  });

  it("allows a renamed branch to keep its own name", () => {
    expect(checkNewBranchName("feature/a", branches, "feature/a")).toBeNull();
  });

  it("rejects malformed names", () => {
    expect(checkNewBranchName("has space", branches)).toBe("invalid");
    expect(checkNewBranchName("trailing/", branches)).toBe("invalid");
    expect(checkNewBranchName("", branches)).toBe("invalid");
  });
});

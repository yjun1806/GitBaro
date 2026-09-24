import { describe, expect, it } from "vitest";
import { isMergeConflictError } from "../utils";

describe("isMergeConflictError", () => {
  it("recognizes the typed conflict error from the backend", () => {
    expect(
      isMergeConflictError({ type: "MergeConflict", message: "CONFLICT (content): Merge conflict in f" }),
    ).toBe(true);
  });

  it("does not guess from the message text", () => {
    expect(isMergeConflictError({ type: "GitCli", message: "conflict" })).toBe(false);
    expect(isMergeConflictError("MergeConflict")).toBe(false);
    expect(isMergeConflictError(null)).toBe(false);
  });
});

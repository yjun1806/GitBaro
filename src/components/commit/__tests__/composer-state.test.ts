import { describe, expect, it } from "vitest";
import { canCommit, isComposerCollapsed } from "../composer-state";

describe("isComposerCollapsed", () => {
  it("collapses to 'no changes' when nothing is uncommitted", () => {
    expect(isComposerCollapsed(0, false)).toBe(true);
  });

  it("shows the composer as soon as a change appears", () => {
    expect(isComposerCollapsed(1, false)).toBe(false);
  });

  it("keeps the composer while a merge waits to be concluded", () => {
    expect(isComposerCollapsed(0, true)).toBe(false);
  });

  it("does not flicker while the status is still loading", () => {
    expect(isComposerCollapsed(null, false)).toBe(false);
  });
});

describe("canCommit", () => {
  it("needs a summary and staged files", () => {
    expect(canCommit("fix: x", 1, null)).toBe(true);
    expect(canCommit("  ", 1, null)).toBe(false);
    expect(canCommit("fix: x", 0, null)).toBe(false);
  });

  it("concludes a merge without staged files", () => {
    expect(canCommit("Merge branch 'feat'", 0, "merge")).toBe(true);
    expect(canCommit("", 0, "merge")).toBe(false);
  });

  it("does not offer an empty commit for other stopped operations", () => {
    expect(canCommit("x", 0, "revert")).toBe(false);
    expect(canCommit("x", 0, "rebase")).toBe(false);
  });
});

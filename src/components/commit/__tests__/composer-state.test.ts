import { describe, expect, it } from "vitest";
import { isComposerCollapsed } from "../composer-state";

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

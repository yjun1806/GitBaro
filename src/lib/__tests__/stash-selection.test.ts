import { describe, expect, it } from "vitest";
import { selectionAfterStashPushed, selectionAfterStashRemoved } from "../stash-selection";

describe("selectionAfterStashRemoved", () => {
  it("clears the selection when the selected stash is removed", () => {
    expect(selectionAfterStashRemoved(2, 2)).toBeNull();
  });

  it("moves the selection up when an entry above it is removed", () => {
    expect(selectionAfterStashRemoved(3, 1)).toBe(2);
  });

  it("keeps the selection when an entry below it is removed", () => {
    expect(selectionAfterStashRemoved(0, 2)).toBe(0);
  });

  it("keeps an empty selection empty", () => {
    expect(selectionAfterStashRemoved(null, 0)).toBeNull();
  });
});

describe("selectionAfterStashPushed", () => {
  it("moves the selection down by one", () => {
    expect(selectionAfterStashPushed(0)).toBe(1);
  });

  it("keeps an empty selection empty", () => {
    expect(selectionAfterStashPushed(null)).toBeNull();
  });
});

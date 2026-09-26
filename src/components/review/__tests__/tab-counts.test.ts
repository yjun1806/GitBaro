import { describe, expect, it } from "vitest";
import { activeRunCount, badgeCount } from "../tab-counts";

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

describe("activeRunCount", () => {
  it("counts runs that are running or waiting, not finished ones", () => {
    expect(
      activeRunCount([{ status: "in_progress" }, { status: "queued" }, { status: "completed" }]),
    ).toBe(2);
  });
});

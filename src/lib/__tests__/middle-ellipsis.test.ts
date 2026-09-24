import { describe, expect, it } from "vitest";
import { middleEllipsis } from "../middle-ellipsis";

describe("middleEllipsis", () => {
  it("returns the text unchanged when it already fits", () => {
    expect(middleEllipsis("main", 10)).toBe("main");
    expect(middleEllipsis("exact", 5)).toBe("exact");
  });

  it("cuts the middle out, keeping the start and end", () => {
    const result = middleEllipsis("feat/review-redesign", 12);
    expect(result).toHaveLength(12);
    expect(result).toContain("…");
    expect(result.startsWith("feat/")).toBe(true);
    expect(result.endsWith("sign")).toBe(true);
  });

  it("favors the head by one character on an odd split", () => {
    // keep = maxLength - 1 = 5, head = 3, tail = 2
    expect(middleEllipsis("abcdefgh", 6)).toBe("abc…gh");
  });

  it("returns just the ellipsis when maxLength is 1", () => {
    expect(middleEllipsis("abcdef", 1)).toBe("…");
  });

  it("returns an empty string when maxLength is 0 or negative", () => {
    expect(middleEllipsis("abcdef", 0)).toBe("");
    expect(middleEllipsis("abcdef", -3)).toBe("");
  });

  it("never returns a string longer than maxLength", () => {
    for (const len of [2, 3, 4, 5, 10, 20]) {
      expect(middleEllipsis("a-very-long-branch-name/with-slashes", len).length).toBeLessThanOrEqual(len);
    }
  });
});

import { describe, expect, it } from "vitest";
import { diffDelta, LCS_CELL_LIMIT, splitLines, toRanges } from "../diff-delta";

const lines = (...xs: string[]) => xs.join("\n") + "\n";

describe("diffDelta", () => {
  it("finds nothing when the content did not change", () => {
    const text = lines("a", "b");
    expect(diffDelta(text, text)).toEqual({ added: [], ranges: [], removedCount: 0 });
  });

  it("finds lines inserted in the middle (the D4 example: lines 24-26)", () => {
    const before = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    const after = [...before.slice(0, 23), "if (!dto.channels?.length) {", "  throw new Error();", "}", ...before.slice(23)];
    const delta = diffDelta(lines(...before), lines(...after));
    expect(delta.added).toEqual([24, 25, 26]);
    expect(delta.ranges).toEqual([{ start: 24, end: 26 }]);
    expect(delta.removedCount).toBe(0);
  });

  it("finds lines appended at the end and at the very start", () => {
    expect(diffDelta(lines("a", "b"), lines("a", "b", "c")).added).toEqual([3]);
    expect(diffDelta(lines("a", "b"), lines("z", "a", "b")).added).toEqual([1]);
  });

  it("treats a changed line as a new line and counts the old one as removed", () => {
    const delta = diffDelta(lines("a", "b", "c"), lines("a", "B", "c"));
    expect(delta.added).toEqual([2]);
    expect(delta.removedCount).toBe(1);
  });

  it("reports only removals when lines were deleted", () => {
    const delta = diffDelta(lines("a", "b", "c", "d"), lines("a", "d"));
    expect(delta.added).toEqual([]);
    expect(delta.removedCount).toBe(2);
  });

  it("does not mark repeated lines (braces) as new when a block is added between them", () => {
    const before = lines("function a() {", "}", "", "function c() {", "}");
    const after = lines("function a() {", "}", "", "function b() {", "}", "", "function c() {", "}");
    const delta = diffDelta(before, after);
    expect(delta.added).toHaveLength(3);
    expect(delta.ranges).toHaveLength(1);
    expect(delta.removedCount).toBe(0);
  });

  it("splits separate edits into separate ranges", () => {
    const before = lines("1", "2", "3", "4", "5", "6");
    const after = lines("1", "x", "2", "3", "4", "y", "z", "5", "6");
    expect(diffDelta(before, after).ranges).toEqual([
      { start: 2, end: 2 },
      { start: 6, end: 7 },
    ]);
  });

  it("marks everything as new when the file was empty before", () => {
    expect(diffDelta("", lines("a", "b")).ranges).toEqual([{ start: 1, end: 2 }]);
  });

  it("handles CRLF files like LF files", () => {
    expect(diffDelta("a\r\nb\r\n", "a\r\nx\r\nb\r\n").added).toEqual([2]);
  });

  it("falls back to counting lines when the changed middle is too large for the table", () => {
    const size = Math.ceil(Math.sqrt(LCS_CELL_LIMIT)) + 10;
    const before = Array.from({ length: size }, (_, i) => `old ${i}`);
    const after = Array.from({ length: size }, (_, i) => (i === 5 ? "kept" : `new ${i}`));
    const delta = diffDelta(lines("head", ...before, "kept", "tail"), lines("head", ...after, "tail"));
    // 「kept」 한 줄만 짝이 있다. 나머지는 모두 새 줄이다.
    expect(delta.added).toHaveLength(size - 1);
    expect(delta.added).not.toContain(2 + 5);
    expect(delta.removedCount).toBe(size);
  });
});

describe("toRanges", () => {
  it("groups consecutive numbers regardless of order and duplicates", () => {
    expect(toRanges([5, 1, 2, 2, 3, 9])).toEqual([
      { start: 1, end: 3 },
      { start: 5, end: 5 },
      { start: 9, end: 9 },
    ]);
    expect(toRanges([])).toEqual([]);
  });
});

describe("splitLines", () => {
  it("returns no lines for empty content", () => {
    expect(splitLines("")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { compileFindRegex, findLineMatches, stepMatch, type FindCell } from "../diff-find";

describe("compileFindRegex", () => {
  it("is empty for an empty query", () => {
    expect(compileFindRegex({ query: "", caseSensitive: false })).toBeNull();
  });

  it("matches special characters literally", () => {
    const re = compileFindRegex({ query: "a.b(c)*", caseSensitive: true })!;
    expect("xa.b(c)*y".match(re)).toEqual(["a.b(c)*"]);
    expect("aXb(c)".match(re)).toBeNull();
  });

  it("ignores case unless asked", () => {
    expect("Foo foo FOO".match(compileFindRegex({ query: "foo", caseSensitive: false })!)).toHaveLength(3);
    expect("Foo foo FOO".match(compileFindRegex({ query: "foo", caseSensitive: true })!)).toHaveLength(1);
  });
});

describe("findLineMatches", () => {
  const rows: FindCell[][] = [
    [{ side: "line", text: "foo bar foo" }],
    [],
    [
      { side: "old", text: "nothing" },
      { side: "new", text: "FOO" },
    ],
  ];
  const re = compileFindRegex({ query: "foo", caseSensitive: false })!;

  it("counts every occurrence in row order, numbering them within a cell", () => {
    expect(findLineMatches(rows.length, (r) => rows[r], re)).toEqual({
      matches: [
        { row: 0, side: "line", nth: 0 },
        { row: 0, side: "line", nth: 1 },
        { row: 2, side: "new", nth: 0 },
      ],
      capped: false,
    });
  });

  it("stops at the limit and says so", () => {
    const result = findLineMatches(rows.length, (r) => rows[r], re, 2);
    expect(result.matches).toHaveLength(2);
    expect(result.capped).toBe(true);
  });

  it("does not leak state between searches with the same regex", () => {
    findLineMatches(rows.length, (r) => rows[r], re);
    expect(findLineMatches(rows.length, (r) => rows[r], re).matches).toHaveLength(3);
  });

  it("stays fast on a 50k-line diff", () => {
    const cells: FindCell[] = [{ side: "line", text: "const value = computeSomething(arg1, arg2); // note" }];
    const start = performance.now();
    const { matches } = findLineMatches(50_000, () => cells, compileFindRegex({ query: "note", caseSensitive: false })!);
    expect(matches).toHaveLength(10_000);
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe("stepMatch", () => {
  it("wraps forward from the last to the first", () => {
    expect(stepMatch(2, 3, 1)).toBe(0);
    expect(stepMatch(0, 3, 1)).toBe(1);
  });

  it("wraps backward from the first to the last", () => {
    expect(stepMatch(0, 3, -1)).toBe(2);
  });

  it("stays at zero when there is nothing to step to", () => {
    expect(stepMatch(0, 0, 1)).toBe(0);
    expect(stepMatch(0, 0, -1)).toBe(0);
  });
});

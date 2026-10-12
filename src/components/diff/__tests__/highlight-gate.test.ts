import { describe, expect, it } from "vitest";
import type { DiffOutput } from "@/types";
import {
  HIGHLIGHT_CHAR_LIMIT,
  HIGHLIGHT_LINE_LIMIT,
  HIGHLIGHT_ROW_LIMIT,
  highlightOffReason,
} from "../highlight-gate";

function diffOf(lines: string[], oldContent = "", newContent = lines.join("\n")): DiffOutput {
  return {
    filePath: "a.js",
    oldContent,
    newContent,
    binary: false,
    hunks: [
      {
        oldStart: 1,
        oldLines: 0,
        newStart: 1,
        newLines: lines.length,
        header: "@@",
        lines: lines.map((content, i) => ({ content, lineType: "add" as const, oldLineNo: null, newLineNo: i + 1 })),
      },
    ],
  };
}

describe("highlightOffReason", () => {
  it("allows a small diff", () => {
    expect(highlightOffReason(diffOf(["a", "b"]), 2)).toBeNull();
  });

  it("turns off past the row limit", () => {
    expect(highlightOffReason(diffOf(["a"]), HIGHLIGHT_ROW_LIMIT + 1)).toBe("rows");
  });

  it("turns off for a single very long line even though there are few rows", () => {
    expect(highlightOffReason(diffOf(["x".repeat(HIGHLIGHT_LINE_LIMIT + 1)]), 1)).toBe("size");
  });

  it("allows a line exactly at the line limit", () => {
    expect(highlightOffReason(diffOf(["x".repeat(HIGHLIGHT_LINE_LIMIT)]), 1)).toBeNull();
  });

  it("turns off when old + new content exceed the character limit", () => {
    const half = "y".repeat(HIGHLIGHT_CHAR_LIMIT / 2 + 1);
    expect(highlightOffReason(diffOf(["a"], half, half), 1)).toBe("size");
  });
});

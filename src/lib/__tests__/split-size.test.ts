import { describe, expect, it } from "vitest";
import {
  clampFileListWidth,
  clampGraphRatio,
  DEFAULT_FILE_LIST_WIDTH,
  DEFAULT_GRAPH_RATIO,
  graphRatioAfterDrag,
  MAX_FILE_LIST_WIDTH,
  MAX_GRAPH_RATIO,
  MIN_FILE_LIST_WIDTH,
  MIN_GRAPH_RATIO,
} from "@/lib/split-size";

describe("clampGraphRatio", () => {
  it("keeps a ratio inside the range", () => {
    expect(clampGraphRatio(0.5)).toBe(0.5);
  });

  it("stops at the minimum and maximum so neither pane disappears", () => {
    expect(clampGraphRatio(0.01)).toBe(MIN_GRAPH_RATIO);
    expect(clampGraphRatio(0.99)).toBe(MAX_GRAPH_RATIO);
  });

  it("falls back to the default for a non-number", () => {
    expect(clampGraphRatio(Number.NaN)).toBe(DEFAULT_GRAPH_RATIO);
    expect(clampGraphRatio(Number.POSITIVE_INFINITY)).toBe(DEFAULT_GRAPH_RATIO);
  });
});

describe("clampFileListWidth", () => {
  it("keeps a width inside the range, rounded to whole pixels", () => {
    expect(clampFileListWidth(400.6)).toBe(401);
  });

  it("stops at the minimum and maximum", () => {
    expect(clampFileListWidth(20)).toBe(MIN_FILE_LIST_WIDTH);
    expect(clampFileListWidth(5000)).toBe(MAX_FILE_LIST_WIDTH);
  });

  it("falls back to the default for a non-number", () => {
    expect(clampFileListWidth(Number.NaN)).toBe(DEFAULT_FILE_LIST_WIDTH);
  });
});

describe("graphRatioAfterDrag", () => {
  it("moves the ratio by the dragged share of the container", () => {
    // 1000px 칸에서 100px 아래로 끌면 10%p 커진다.
    expect(graphRatioAfterDrag(0.4, 100, 1000)).toBeCloseTo(0.5);
    expect(graphRatioAfterDrag(0.4, -100, 1000)).toBeCloseTo(0.3);
  });

  it("clamps the result", () => {
    expect(graphRatioAfterDrag(0.4, 5000, 1000)).toBe(MAX_GRAPH_RATIO);
    expect(graphRatioAfterDrag(0.4, -5000, 1000)).toBe(MIN_GRAPH_RATIO);
  });

  it("keeps the ratio while the container height is unknown", () => {
    expect(graphRatioAfterDrag(0.4, 100, 0)).toBe(0.4);
  });
});

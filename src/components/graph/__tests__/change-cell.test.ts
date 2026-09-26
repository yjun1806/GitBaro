import { describe, expect, it } from "vitest";
import { changeBarWidths } from "../change-cell";

describe("changeBarWidths (커밋 줄 「변경」 칸 크기 막대, 3.15)", () => {
  it("clamps the bar to the minimum width when there is no change at all", () => {
    expect(changeBarWidths(0, 0)).toEqual({ barWidth: 4, addWidth: 0, delWidth: 4 });
  });

  it("clamps the bar to the maximum width for a very large change", () => {
    const { barWidth, addWidth, delWidth } = changeBarWidths(5000, 0);
    expect(barWidth).toBe(40);
    expect(addWidth).toBe(40);
    expect(delWidth).toBe(0);
  });

  it("splits the bar between additions and deletions in proportion", () => {
    // total=8 → barWidth = round(9*log2(1+2)) = round(9*1.585) = 14, split evenly.
    const result = changeBarWidths(4, 4);
    expect(result.barWidth).toBe(14);
    expect(result.addWidth).toBe(7);
    expect(result.delWidth).toBe(7);
    expect(result.addWidth + result.delWidth).toBe(result.barWidth);
  });

  it("gives the whole bar to additions when there are no deletions", () => {
    const result = changeBarWidths(10, 0);
    expect(result.addWidth).toBe(result.barWidth);
    expect(result.delWidth).toBe(0);
  });

  it("gives the whole bar to deletions when there are no additions", () => {
    const result = changeBarWidths(0, 10);
    expect(result.addWidth).toBe(0);
    expect(result.delWidth).toBe(result.barWidth);
  });

  it("grows monotonically with the total amount of change", () => {
    const small = changeBarWidths(1, 0).barWidth;
    const medium = changeBarWidths(20, 0).barWidth;
    const large = changeBarWidths(500, 0).barWidth;
    expect(small).toBeLessThanOrEqual(medium);
    expect(medium).toBeLessThanOrEqual(large);
  });
});

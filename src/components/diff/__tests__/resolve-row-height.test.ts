// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { resolveRowHeight } from "../VirtualizedDiffView";

// W1-T1 리뷰 지적: diff 줄 높이가 `Math.round(fontSize * 1.6)`(12*1.6≈19px)로 고정돼,
// globals.css의 `--code-lh: 21px`(촘촘 밀도, plans/design/README.md:49)이 실제 diff에는
// 반영되지 않았다. `resolveRowHeight`는 그 토큰 값을 읽어 실제 렌더 높이로 쓴다.

afterEach(() => {
  document.documentElement.style.removeProperty("--code-lh");
});

describe("resolveRowHeight", () => {
  it("--code-lh 토큰이 있으면 그 값을 그대로 diff 줄 높이로 쓴다", () => {
    document.documentElement.style.setProperty("--code-lh", "21px");
    expect(resolveRowHeight(12)).toBe(21);
  });

  it("토큰이 비어 있으면 기존 fontSize*1.6 어림값으로 되돌아간다", () => {
    expect(resolveRowHeight(12)).toBe(Math.round(12 * 1.6));
  });

  it("토큰 값이 숫자로 읽히지 않으면(0 이하 포함) 어림값을 쓴다", () => {
    document.documentElement.style.setProperty("--code-lh", "not-a-number");
    expect(resolveRowHeight(12)).toBe(Math.round(12 * 1.6));
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { DiffFile } from "@git-diff-view/core";

// jsdom은 레이아웃이 없어 가상 목록이 행을 하나도 그리지 않는다. 모든 행을 그리게 하고
// 따라가기가 부르는 scrollToIndex를 기록한다.
const scrollToIndex = vi.fn();
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 21 })),
    getTotalSize: () => count * 21,
    measureElement: () => {},
    measurementsCache: [],
    scrollToIndex,
  }),
}));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const { VirtualizedDiffView } = await import("../VirtualizedDiffView");

const OLD = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
// 3행 뒤에 세 줄(새 쪽 4–6행)을 넣었다.
const NEW = ["line 1", "line 2", "line 3", "x", "y", "z", ...Array.from({ length: 7 }, (_, i) => `line ${i + 4}`)].join("\n") + "\n";
const PATCH = [
  "--- a/f.ts",
  "+++ b/f.ts",
  "@@ -1,6 +1,9 @@",
  " line 1",
  " line 2",
  " line 3",
  "+x",
  "+y",
  "+z",
  " line 4",
  " line 5",
  " line 6",
].join("\n");

function buildFile() {
  const file = new DiffFile("f.ts", OLD, "f.ts", NEW, [PATCH], "typescript", "typescript");
  file.initRaw();
  file.buildUnifiedDiffLines();
  file.buildSplitDiffLines();
  return file;
}

function renderView(viewMode: "unified" | "split", freshLines?: ReadonlySet<number>, revealLine: number | null = null) {
  return render(
    <VirtualizedDiffView
      diffFile={buildFile()}
      viewMode={viewMode}
      isDark={false}
      highlight={false}
      fontSize={12}
      freshLines={freshLines}
      revealLine={revealLine}
    />,
  );
}

beforeEach(() => scrollToIndex.mockClear());
afterEach(cleanup);

describe("VirtualizedDiffView fresh lines (follow mode)", () => {
  it.each(["unified", "split"] as const)("marks exactly the fresh new-side lines in %s view", (mode) => {
    const { container } = renderView(mode, new Set([4, 5, 6]));
    const marked = [...container.querySelectorAll("[data-fresh]")].map((el) => el.textContent ?? "");
    expect(marked).toHaveLength(3);
    expect(marked.map((t) => t.trim().slice(-1))).toEqual(["x", "y", "z"]);
  });

  it("marks nothing without fresh lines", () => {
    const { container } = renderView("unified");
    expect(container.querySelectorAll("[data-fresh]")).toHaveLength(0);
  });

  it.each(["unified", "split"] as const)("scrolls the revealed new-side line into the middle in %s view", (mode) => {
    const file = buildFile();
    const { rerender } = render(
      <VirtualizedDiffView diffFile={file} viewMode={mode} isDark={false} highlight={false} fontSize={12} revealLine={5} />,
    );
    expect(scrollToIndex).toHaveBeenCalledTimes(1);
    const [index, options] = scrollToIndex.mock.calls[0];
    expect(options).toEqual({ align: "center" });
    // The row at that index is the one showing new line 5 ("y"). Row 0 is the hunk header, so line rows start at 1.
    const lineNo =
      mode === "split" ? file.getSplitRightLine(index - 1).lineNumber : file.getUnifiedLine(index - 1).newLineNumber;
    expect(lineNo).toBe(5);

    // The same line again (the file was re-read) does not scroll a second time.
    rerender(
      <VirtualizedDiffView diffFile={file} viewMode={mode} isDark={false} highlight={false} fontSize={12} revealLine={5} />,
    );
    expect(scrollToIndex).toHaveBeenCalledTimes(1);
  });
});

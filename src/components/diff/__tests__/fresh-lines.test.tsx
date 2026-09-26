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

const { VirtualizedDiffView, FRESH_FLASH_MS } = await import("../VirtualizedDiffView");

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

function renderView(
  viewMode: "unified" | "split",
  freshLines?: ReadonlySet<number>,
  revealLine: number | null = null,
  freshAt: number | null = null,
) {
  return render(
    <VirtualizedDiffView
      diffFile={buildFile()}
      viewMode={viewMode}
      isDark={false}
      highlight={false}
      fontSize={12}
      freshLines={freshLines}
      freshAt={freshAt}
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

  it.each(["unified", "split"] as const)(
    "marks the new-side line number of fresh lines instead of drawing a bar on the left edge in %s view",
    (mode) => {
      const { container } = renderView(mode, new Set([4, 5, 6]));
      const numbers = [...container.querySelectorAll<HTMLElement>("[data-fresh-no]")];
      expect(numbers.map((el) => el.textContent)).toEqual(["4", "5", "6"]);
      expect(numbers.every((el) => el.getAttribute("data-line-no") === "new")).toBe(true);
      // 사용자가 싫어하는 왼쪽 세로 막대(inset 그림자·왼쪽 테두리)는 어느 줄에도 없다.
      const rows = [...container.querySelectorAll<HTMLElement>("[data-fresh]")];
      expect(rows.every((el) => !el.style.boxShadow && !el.style.borderLeft)).toBe(true);
    },
  );

  it.each(["unified", "split"] as const)(
    "flashes the fresh lines drawn right after they arrive, and only marks them later in %s view",
    (mode) => {
      const fresh = new Set([4, 5, 6]);
      // Drawn within the flash window: every fresh line carries the one-time overlay, inside the marked row.
      const { container, unmount } = renderView(mode, fresh, null, Date.now());
      const overlays = [...container.querySelectorAll("[data-focus-flash]")];
      expect(overlays).toHaveLength(3);
      expect(overlays.every((el) => el.parentElement?.hasAttribute("data-fresh"))).toBe(true);
      unmount();

      // Drawn after the window (a row scrolled back into view): the lasting mark only, no replay.
      const late = renderView(mode, fresh, null, Date.now() - FRESH_FLASH_MS - 1);
      expect(late.container.querySelectorAll("[data-fresh]")).toHaveLength(3);
      expect(late.container.querySelectorAll("[data-focus-flash]")).toHaveLength(0);
      late.unmount();

      // No arrival time at all: the lasting mark only.
      const none = renderView(mode, fresh);
      expect(none.container.querySelectorAll("[data-focus-flash]")).toHaveLength(0);
    },
  );

  it("flashes again when the same lines change once more", () => {
    // 같은 줄이 또 바뀌면 새 도착 시각이 오고, 막은 새로 마운트돼 다시 비춘다.
    const fresh = new Set([4, 5, 6]);
    const at = Date.now();
    const view = (freshAt: number) => (
      <VirtualizedDiffView
        diffFile={buildFile()}
        viewMode="unified"
        isDark={false}
        highlight={false}
        fontSize={12}
        freshLines={fresh}
        freshAt={freshAt}
      />
    );
    const { container, rerender } = render(view(at));
    const first = container.querySelector("[data-focus-flash]");
    rerender(view(at));
    expect(container.querySelector("[data-focus-flash]")).toBe(first);
    rerender(view(at + 1));
    expect(container.querySelector("[data-focus-flash]")).not.toBe(first);
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

  it("scrolls to the same line again when the reveal nonce changes", () => {
    // PR 스레드의 같은 줄을 다시 누르면(그 사이 스크롤했어도) 다시 그 줄로 간다.
    const file = buildFile();
    const view = (nonce: number) => (
      <VirtualizedDiffView
        diffFile={file}
        viewMode="unified"
        isDark={false}
        highlight={false}
        fontSize={12}
        revealLine={5}
        revealNonce={nonce}
      />
    );
    const { rerender } = render(view(0));
    expect(scrollToIndex).toHaveBeenCalledTimes(1);
    rerender(view(1));
    expect(scrollToIndex).toHaveBeenCalledTimes(2);
  });
});

describe("VirtualizedDiffView find scrolling", () => {
  it("does not jump back to the active match when the rows are rebuilt", () => {
    // 찾기가 열린 채 diff가 다시 조회되면(새 diffFile) 행 배열이 새로 만들어진다. 사용자가 스크롤한
    // 자리를 지키고, 일치 번호나 찾는 말이 바뀔 때만 움직인다.
    const find = { regex: /x/gi, active: 0, nonce: 0 };
    const view = (file: ReturnType<typeof buildFile>, f: typeof find) => (
      <VirtualizedDiffView diffFile={file} viewMode="unified" isDark={false} highlight={false} fontSize={12} find={f} />
    );
    const { rerender } = render(view(buildFile(), find));
    expect(scrollToIndex).toHaveBeenCalledTimes(1);
    rerender(view(buildFile(), { ...find }));
    expect(scrollToIndex).toHaveBeenCalledTimes(1);
    rerender(view(buildFile(), { ...find, nonce: 1 }));
    expect(scrollToIndex).toHaveBeenCalledTimes(2);
  });
});

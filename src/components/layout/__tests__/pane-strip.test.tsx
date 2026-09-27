// @vitest-environment jsdom
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18n from "@/i18n/config";
import { useUIStore } from "@/stores/ui";
import { GRAPH_NARROW_WIDTH } from "@/lib/split-size";
import { useGraphNarrow, usePaneStore } from "../pane-state";
import { NarrowPaneHeader } from "../NarrowPaneHeader";
import { PaneStrip } from "../PaneStrip";

// jsdom에는 PointerEvent가 없다. 좌표·버튼은 MouseEvent가 싣고 있으니 그 위에 pointerId만 더한다.
if (typeof window.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  useUIStore.setState({ isDiffMaximized: false, diffFileOpen: false });
  usePaneStore.setState({ graphExpanded: false });
  useUIStore.setState({ paneGraphRatio: 0.46, narrowListWidth: GRAPH_NARROW_WIDTH });
});
afterEach(cleanup);

/** 좁은 목록인지 스스로 말하는 그래프 칸(2단계에서만 머리 줄을 둔다 — 실제 그래프 카드와 같은 규칙). */
function NarrowAwareGraph() {
  const narrow = useGraphNarrow();
  return (
    <div>
      {narrow && <NarrowPaneHeader label="Commit graph" />}
      graph-content{narrow ? " (narrow)" : ""}
    </div>
  );
}

function renderStrip(hasSelection: boolean) {
  return render(<PaneStrip graph={<NarrowAwareGraph />} hasSelection={hasSelection} bottom={<div>bottom-content</div>} />);
}

describe("PaneStrip (D47/5.4 stacked panes)", () => {
  it("0단계: gives the graph the full width and does not mount bottom", () => {
    renderStrip(false);
    expect(screen.getByTestId("graph-pane").dataset.paneLevel).toBe("0");
    expect(screen.getByTestId("graph-pane").style.width).toBe("100%");
    expect(screen.queryByTestId("pane-strip-bottom")).toBeNull();
    expect(screen.getByText("graph-content")).toBeTruthy();
  });

  it("1단계: shrinks the graph to 46% and mounts bottom once something is picked", () => {
    renderStrip(true);
    expect(screen.getByTestId("graph-pane").dataset.paneLevel).toBe("1");
    expect(screen.getByTestId("graph-pane").style.width).toBe("46%");
    expect(screen.getByTestId("pane-strip-bottom")).toBeTruthy();
    expect(screen.getByText("bottom-content")).toBeTruthy();
  });

  it("2단계: keeps the graph as a narrow commit list once a file is open", () => {
    useUIStore.setState({ diffFileOpen: true });
    renderStrip(true);
    const pane = screen.getByTestId("graph-pane");
    expect(pane.dataset.paneLevel).toBe("2");
    expect(pane.style.width).toBe(`${GRAPH_NARROW_WIDTH}px`);
    // 목록은 가려지지 않고 눌러 쓸 수 있다(옛 접힌 칸의 덮개·inert가 없다).
    expect(screen.getByText("graph-content (narrow)")).toBeTruthy();
    expect(pane.querySelector("[inert]")).toBeNull();
    // 파일 목록이 220px까지 줄고 diff 424px를 지킨 폭보다 좁아지면 가로 스크롤한다.
    expect(screen.getByTestId("pane-strip-bottom").style.minWidth).toBe("652px");
  });

  it("goes back to the level-1 width from “Expand the graph”, keeping the file open, and narrows again on reset", () => {
    useUIStore.setState({ diffFileOpen: true });
    const { rerender } = renderStrip(true);
    fireEvent.click(screen.getByRole("button", { name: "Expand the graph" }));
    const pane = screen.getByTestId("graph-pane");
    expect(pane.dataset.paneLevel).toBe("1");
    expect(pane.style.width).toBe("46%");
    expect(screen.getByText("graph-content")).toBeTruthy();
    expect(useUIStore.getState().diffFileOpen).toBe(true);

    // 고른 행이 없어지면(0단계) 펼침도 풀려, 다음에 파일을 열면 다시 좁은 목록이다.
    rerender(<PaneStrip graph={<NarrowAwareGraph />} hasSelection={false} bottom={<div>bottom-content</div>} />);
    expect(usePaneStore.getState().graphExpanded).toBe(false);
  });

  it("3단계: pushes the graph out to 0 width while maximized, keeping bottom mounted", () => {
    useUIStore.setState({ diffFileOpen: true, isDiffMaximized: true });
    renderStrip(true);
    const pane = screen.getByTestId("graph-pane");
    expect(pane.dataset.paneLevel).toBe("3");
    expect(pane.style.width).toBe("0px");
    expect(screen.getByTestId("pane-strip-bottom")).toBeTruthy();
    // 3단계에서는 그래프 자체가 밀려 나가 좁은 목록 머리 줄도 없다.
    expect(screen.queryByRole("button", { name: "Expand the graph" })).toBeNull();
  });

  it("never remounts the graph across level changes", () => {
    let mounts = 0;
    function Graph() {
      useEffect(() => {
        mounts += 1;
      }, []);
      return <div>graph</div>;
    }
    const { rerender } = render(
      <PaneStrip graph={<Graph />} hasSelection={false} bottom={<div>bottom</div>} />,
    );
    expect(mounts).toBe(1);
    rerender(<PaneStrip graph={<Graph />} hasSelection bottom={<div>bottom</div>} />);
    act(() => useUIStore.getState().setDiffFileOpen(true));
    rerender(<PaneStrip graph={<Graph />} hasSelection bottom={<div>bottom</div>} />);
    act(() => useUIStore.getState().setDiffMaximized(true));
    rerender(<PaneStrip graph={<Graph />} hasSelection bottom={<div>bottom</div>} />);
    expect(mounts).toBe(1);
  });
});

describe("PaneStrip resize handle (5.4)", () => {
  function drag(handle: HTMLElement, dx: number) {
    fireEvent.pointerDown(handle, { button: 0, clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 500 + dx, pointerId: 1 });
  }

  it("1단계: dragging changes and saves the graph ratio, from the width on screen, without the width transition", () => {
    // 줄 폭 1000px, 그래프 칸이 화면에 460px로 보이는 상태.
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 460 } as DOMRect);
    try {
      renderStrip(true);
      const pane = screen.getByTestId("graph-pane");
      expect(pane.className).toContain("pane-w");
      const handle = screen.getByRole("separator", { name: "Resize the graph pane (double-click to reset)" });
      drag(handle, 100);
      expect(useUIStore.getState().paneGraphRatio).toBeCloseTo(0.56);
      expect(pane.style.width).toBe("56%");
      // 끄는 동안에는 폭 전환 애니메이션이 없다. 놓으면 돌아온다.
      expect(pane.className).not.toContain("pane-w");
      fireEvent.pointerUp(handle, { clientX: 600, pointerId: 1 });
      expect(pane.className).toContain("pane-w");

      fireEvent.doubleClick(handle);
      expect(useUIStore.getState().paneGraphRatio).toBe(0.46);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("1단계: keeps the graph at least 400px and the side pane at its minimum on screen, leaving the saved ratio alone", () => {
    useUIStore.setState({ paneGraphRatio: 0.2 });
    renderStrip(true);
    const pane = screen.getByTestId("graph-pane");
    expect(pane.style.width).toBe("20%");
    expect(pane.style.minWidth).toBe("min(400px, calc(100% - 288px))");
    expect(pane.style.maxWidth).toBe("calc(100% - 288px)");
    expect(useUIStore.getState().paneGraphRatio).toBe(0.2);
  });

  it("2단계: dragging changes and saves the narrow list width within 180–400px, and resets on double-click", () => {
    useUIStore.setState({ diffFileOpen: true });
    renderStrip(true);
    const pane = screen.getByTestId("graph-pane");
    const handle = screen.getByRole("separator", { name: "Resize the graph pane (double-click to reset)" });
    drag(handle, 40);
    expect(useUIStore.getState().narrowListWidth).toBe(280);
    expect(pane.style.width).toBe("280px");
    fireEvent.pointerUp(handle, { clientX: 540, pointerId: 1 });
    drag(handle, -500);
    expect(useUIStore.getState().narrowListWidth).toBe(180);
    fireEvent.pointerUp(handle, { clientX: 0, pointerId: 1 });
    fireEvent.doubleClick(handle);
    expect(useUIStore.getState().narrowListWidth).toBe(GRAPH_NARROW_WIDTH);
  });

  it("moves with the arrow keys and resets with Enter", () => {
    useUIStore.setState({ diffFileOpen: true });
    renderStrip(true);
    const handle = screen.getByRole("separator", { name: "Resize the graph pane (double-click to reset)" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(useUIStore.getState().narrowListWidth).toBe(GRAPH_NARROW_WIDTH + 16);
    fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true });
    expect(useUIStore.getState().narrowListWidth).toBe(GRAPH_NARROW_WIDTH + 16 - 64);
    fireEvent.keyDown(handle, { key: "Enter" });
    expect(useUIStore.getState().narrowListWidth).toBe(GRAPH_NARROW_WIDTH);
  });

  it("has no handle at level 0 or while maximized", () => {
    const { unmount } = renderStrip(false);
    expect(screen.queryByRole("separator")).toBeNull();
    unmount();
    useUIStore.setState({ diffFileOpen: true, isDiffMaximized: true });
    renderStrip(true);
    expect(screen.queryByRole("separator")).toBeNull();
  });
});

describe("PaneStrip transition (5.4: calm, one moving edge)", () => {
  function withAnimations(run: () => void) {
    const animate = vi.fn();
    Element.prototype.animate = animate as unknown as typeof Element.prototype.animate;
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
    try {
      run();
    } finally {
      vi.restoreAllMocks();
      delete (Element.prototype as Partial<Element>).animate;
    }
  }
  const inner = () => screen.getByText(/graph-content/).parentElement as HTMLElement;

  it("pins the commit rows at the narrower width for the whole transition: the new width when shrinking", () => {
    withAnimations(() => {
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 1200 } as DOMRect);
      const { rerender } = renderStrip(false);
      rerender(<PaneStrip graph={<NarrowAwareGraph />} hasSelection bottom={<div>bottom-content</div>} />);
      // 0 → 1단계: 1200px에서 46%(552px)로 줄어든다 — 시작하자마자 줄어든 폭으로 한 번 바뀐다.
      expect(inner().style.width).toBe("552px");
    });
  });

  it("keeps the old width until the end when growing", () => {
    withAnimations(() => {
      useUIStore.setState({ diffFileOpen: true });
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 240 } as DOMRect);
      renderStrip(true);
      // 2 → 1단계(그래프 펼치기): 240px에서 넓어진다 — 끝날 때까지 240px 그대로라 글이 넘치지 않는다.
      act(() => usePaneStore.getState().setGraphExpanded(true));
      expect(inner().style.width).toBe("240px");
    });
  });
});

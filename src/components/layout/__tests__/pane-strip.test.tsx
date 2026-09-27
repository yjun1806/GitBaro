// @vitest-environment jsdom
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18n from "@/i18n/config";
import { useUIStore } from "@/stores/ui";
import { GRAPH_NARROW_WIDTH } from "@/lib/split-size";
import { useGraphNarrow, usePaneStore } from "../pane-state";
import { NarrowPaneHeader } from "../NarrowPaneHeader";
import { PaneStrip } from "../PaneStrip";

beforeEach(async () => {
  await i18n.changeLanguage("en");
  useUIStore.setState({ isDiffMaximized: false, diffFileOpen: false });
  usePaneStore.setState({ graphExpanded: false });
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

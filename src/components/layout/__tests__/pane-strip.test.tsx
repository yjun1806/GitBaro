// @vitest-environment jsdom
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18n from "@/i18n/config";
import { useUIStore } from "@/stores/ui";
import { GRAPH_FOLDED_WIDTH } from "@/lib/split-size";
import { PaneStrip } from "../PaneStrip";

beforeEach(async () => {
  await i18n.changeLanguage("en");
  useUIStore.setState({ isDiffMaximized: false, diffFileOpen: false });
});
afterEach(cleanup);

function renderStrip(hasSelection: boolean, onExpandGraph = vi.fn()) {
  return render(
    <PaneStrip
      graph={<div>graph-content</div>}
      hasSelection={hasSelection}
      bottom={<div>bottom-content</div>}
      onExpandGraph={onExpandGraph}
    />,
  );
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

  it("2단계: folds the graph to 120px with a clickable overlay once a file is open", () => {
    useUIStore.setState({ diffFileOpen: true });
    renderStrip(true);
    const pane = screen.getByTestId("graph-pane");
    expect(pane.dataset.paneLevel).toBe("2");
    expect(pane.style.width).toBe(`${GRAPH_FOLDED_WIDTH}px`);
    // The graph itself stays mounted underneath (never remounted, D47 요구).
    expect(screen.getByText("graph-content")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to the graph" })).toBeTruthy();
  });

  it("calls onExpandGraph when the folded graph pane is pressed", () => {
    useUIStore.setState({ diffFileOpen: true });
    const onExpandGraph = vi.fn();
    renderStrip(true, onExpandGraph);
    fireEvent.click(screen.getByRole("button", { name: "Back to the graph" }));
    expect(onExpandGraph).toHaveBeenCalledOnce();
  });

  it("3단계: pushes the graph out to 0 width while maximized, keeping bottom mounted", () => {
    useUIStore.setState({ diffFileOpen: true, isDiffMaximized: true });
    renderStrip(true);
    const pane = screen.getByTestId("graph-pane");
    expect(pane.dataset.paneLevel).toBe("3");
    expect(pane.style.width).toBe("0px");
    expect(screen.getByTestId("pane-strip-bottom")).toBeTruthy();
    // 3단계에서는 접힌 그래프의 눌러 펼치기 칸이 없다(그래프 자체가 밀려 나갔다).
    expect(screen.queryByRole("button", { name: "Back to the graph" })).toBeNull();
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
      <PaneStrip graph={<Graph />} hasSelection={false} bottom={<div>bottom</div>} onExpandGraph={vi.fn()} />,
    );
    expect(mounts).toBe(1);
    rerender(<PaneStrip graph={<Graph />} hasSelection bottom={<div>bottom</div>} onExpandGraph={vi.fn()} />);
    act(() => useUIStore.getState().setDiffFileOpen(true));
    rerender(<PaneStrip graph={<Graph />} hasSelection bottom={<div>bottom</div>} onExpandGraph={vi.fn()} />);
    act(() => useUIStore.getState().setDiffMaximized(true));
    rerender(<PaneStrip graph={<Graph />} hasSelection bottom={<div>bottom</div>} onExpandGraph={vi.fn()} />);
    expect(mounts).toBe(1);
  });
});

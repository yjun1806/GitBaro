// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import i18n from "@/i18n/config";
import { useUIStore } from "@/stores/ui";
import { DEFAULT_FILE_LIST_WIDTH, DEFAULT_GRAPH_RATIO } from "@/lib/split-size";
import { ListDiffSplit } from "../ListDiffSplit";
import { GraphSplit } from "../GraphSplit";

let mounts = 0;
function Counted({ label }: { label: string }) {
  useEffect(() => {
    mounts++;
  }, []);
  return <div>{label}</div>;
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  mounts = 0;
  useUIStore.setState({ fileListWidth: 360, graphPanelRatio: 0.5, isDiffMaximized: false });
});
afterEach(cleanup);

describe("ListDiffSplit", () => {
  it("sizes the list from the shared width and resets it on double-click", () => {
    render(<ListDiffSplit variant="cards" list={<div>list</div>} detail={<div>diff</div>} />);
    expect(screen.getByTestId("list-pane").style.width).toBe("360px");
    fireEvent.doubleClick(screen.getByRole("separator", { name: /Resize file list/ }));
    expect(useUIStore.getState().fileListWidth).toBe(DEFAULT_FILE_LIST_WIDTH);
  });

  it("hides the list and handle while the diff is maximized, without remounting either pane", () => {
    render(<ListDiffSplit variant="inline" list={<Counted label="list" />} detail={<Counted label="diff" />} />);
    expect(mounts).toBe(2);
    act(() => useUIStore.getState().setDiffMaximized(true));
    expect(screen.getByTestId("list-pane").className).toContain("hidden");
    expect(screen.queryByRole("separator")).toBeNull();
    act(() => useUIStore.getState().setDiffMaximized(false));
    expect(screen.getByTestId("list-pane").className).not.toContain("hidden");
    expect(mounts).toBe(2);
  });
});

describe("GraphSplit", () => {
  it("gives the graph its stored share and resets it on double-click", () => {
    render(<GraphSplit top={<div>graph</div>} bottom={<div>bottom</div>} />);
    expect(screen.getByTestId("graph-pane").style.height).toBe("50%");
    fireEvent.doubleClick(screen.getByRole("separator", { name: /Resize graph panel/ }));
    expect(useUIStore.getState().graphPanelRatio).toBe(DEFAULT_GRAPH_RATIO);
  });

  it("keeps the graph mounted when collapsed to its header or hidden for a maximized diff", () => {
    const { rerender } = render(<GraphSplit top={<Counted label="graph" />} bottom={<div>bottom</div>} />);
    rerender(<GraphSplit topCollapsed top={<Counted label="graph" />} bottom={<div>bottom</div>} />);
    expect(screen.queryByRole("separator")).toBeNull();
    expect(screen.getByTestId("graph-pane").style.height).toBe("");
    act(() => useUIStore.getState().setDiffMaximized(true));
    expect(screen.getByTestId("graph-pane").className).toContain("hidden");
    expect(mounts).toBe(1);
  });
});

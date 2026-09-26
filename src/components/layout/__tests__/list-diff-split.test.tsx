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

  it("shows the origin header only while maximized, spanning the whole detail pane, and never without an origin", () => {
    const origin = { kind: "commit" as const, label: <span>c4cbaa5</span> };
    render(<ListDiffSplit variant="inline" list={<div>list</div>} detail={<div>diff</div>} origin={origin} />);
    expect(screen.queryByTestId("maximized-origin-header")).toBeNull();
    act(() => useUIStore.getState().setDiffMaximized(true));
    expect(screen.getByTestId("maximized-origin-header")).toBeTruthy();
    // 파일 목록(있으면)과 diff 위에 걸쳐 카드 전체 폭이다 — detail-pane의 첫 자식이다.
    expect(screen.getByTestId("detail-pane").firstElementChild).toBe(screen.getByTestId("maximized-origin-header"));
  });

  it("removes the origin header immediately on restore, with no exit animation", () => {
    const origin = { kind: "commit" as const, label: <span>c4cbaa5</span> };
    render(<ListDiffSplit variant="inline" list={<div>list</div>} detail={<div>diff</div>} origin={origin} />);
    act(() => useUIStore.getState().setDiffMaximized(true));
    expect(screen.getByTestId("maximized-origin-header")).toBeTruthy();
    act(() => useUIStore.getState().setDiffMaximized(false));
    expect(screen.queryByTestId("maximized-origin-header")).toBeNull();
  });

  it("does not show an origin header when maximized without an origin prop", () => {
    render(<ListDiffSplit variant="inline" list={<div>list</div>} detail={<div>diff</div>} />);
    act(() => useUIStore.getState().setDiffMaximized(true));
    expect(screen.queryByTestId("maximized-origin-header")).toBeNull();
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

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import i18n from "@/i18n/config";
import { useUIStore } from "@/stores/ui";
import {
  DEFAULT_FILE_LIST_WIDTH,
  DEFAULT_GRAPH_RATIO,
  LEVEL1_DETAIL_MIN_WIDTH,
  MAXIMIZED_LIST_FOLDED_WIDTH,
  MAXIMIZED_LIST_WIDTH,
} from "@/lib/split-size";
import type { MaximizedFiles } from "../maximized-files";
import { ListDiffSplit } from "../ListDiffSplit";
import { GraphSplit } from "../GraphSplit";

// jsdom has no scrollIntoView; the maximized file list's keyboard nav scrolls the picked row into view.
Element.prototype.scrollIntoView = () => {};

let mounts = 0;
function Counted({ label }: { label: string }) {
  useEffect(() => {
    mounts++;
  }, []);
  return <div>{label}</div>;
}

/** 2·3단계용 파일 목록. `selectedKey: null`이면 아직 파일을 안 고른 1단계. */
function makeFiles(selectedKey: string | null): MaximizedFiles {
  return {
    items: [
      { key: "a", path: "src/a.ts", status: "modified" },
      { key: "b", path: "src/b.ts", status: "added" },
    ],
    selectedKey,
    onSelect: () => {},
  };
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  mounts = 0;
  useUIStore.setState({
    fileListWidth: 360,
    graphPanelRatio: 0.5,
    isDiffMaximized: false,
    maximizedFileListOpen: true,
    diffFileOpen: false,
  });
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

  describe("1단계 ↔ 2단계 (D47/5.4, files.selectedKey)", () => {
    it("collapses to the list alone until a file is picked, and tells PaneStrip diffFileOpen is false", () => {
      render(
        <ListDiffSplit variant="inline" list={<div>list</div>} detail={<div>diff</div>} files={makeFiles(null)} />,
      );
      expect(screen.getByTestId("list-pane").style.width).toBe("");
      expect(screen.getByTestId("list-pane").style.minWidth).toBe(`${LEVEL1_DETAIL_MIN_WIDTH}px`);
      expect(screen.getByTestId("list-pane").className).toContain("flex-1");
      expect(screen.getByTestId("detail-pane").getAttribute("aria-hidden")).toBe("true");
      expect(screen.queryByRole("separator")).toBeNull();
      expect(useUIStore.getState().diffFileOpen).toBe(false);
    });

    it("opens the diff pane and reports diffFileOpen once a file is picked", () => {
      const { rerender } = render(
        <ListDiffSplit variant="inline" list={<div>list</div>} detail={<div>diff</div>} files={makeFiles(null)} />,
      );
      rerender(
        <ListDiffSplit variant="inline" list={<div>list</div>} detail={<div>diff</div>} files={makeFiles("a")} />,
      );
      expect(screen.getByTestId("list-pane").style.width).toBe("360px");
      expect(screen.getByTestId("detail-pane").getAttribute("aria-hidden")).toBeNull();
      expect(screen.getByRole("separator")).toBeTruthy();
      expect(useUIStore.getState().diffFileOpen).toBe(true);
    });

    it("stays open without files (screens that do not wire the signal yet)", () => {
      render(<ListDiffSplit variant="inline" list={<div>list</div>} detail={<div>diff</div>} />);
      expect(screen.getByTestId("detail-pane").getAttribute("aria-hidden")).toBeNull();
      expect(useUIStore.getState().diffFileOpen).toBe(true);
    });

    it("detailAlwaysOpen keeps the diff pane even with no file picked (PR overview)", () => {
      render(
        <ListDiffSplit
          variant="cards"
          list={<div>list</div>}
          detail={<div>overview</div>}
          files={makeFiles(null)}
          detailAlwaysOpen
        />,
      );
      expect(screen.getByTestId("detail-pane").getAttribute("aria-hidden")).toBeNull();
      expect(screen.getByText("overview")).toBeTruthy();
      expect(useUIStore.getState().diffFileOpen).toBe(true);
    });
  });

  describe("크게 보기의 파일 목록 접기 (5.4, 260 ↔ 36px)", () => {
    it("shows the picked file's name in the origin header, alongside the origin", () => {
      const origin = { kind: "commit" as const, label: <span>c4cbaa5</span> };
      render(
        <ListDiffSplit variant="cards" list={<div>list</div>} detail={<div>diff</div>} origin={origin} files={makeFiles("a")} />,
      );
      act(() => useUIStore.getState().setDiffMaximized(true));
      expect(screen.getByTestId("maximized-origin-header").textContent).toContain("a.ts");
    });

    it("narrows the file list to 260px while maximized, and to a 36px band once folded", () => {
      render(
        <ListDiffSplit variant="cards" list={<div>list</div>} detail={<div>diff</div>} files={makeFiles("a")} />,
      );
      act(() => useUIStore.getState().setDiffMaximized(true));
      expect(screen.getByTestId("maximized-file-list").style.width).toBe(`${MAXIMIZED_LIST_WIDTH}px`);
      act(() => useUIStore.getState().setMaximizedFileListOpen(false));
      expect(screen.queryByTestId("maximized-file-list")).toBeNull();
      const band = screen.getByTestId("maximized-file-list-band");
      expect(band.style.width).toBe(`${MAXIMIZED_LIST_FOLDED_WIDTH}px`);
      fireEvent.click(band);
      expect(useUIStore.getState().maximizedFileListOpen).toBe(true);
      expect(screen.getByTestId("maximized-file-list")).toBeTruthy();
    });

    it("re-expands the folded file list on its own once you leave maximize (원래 크기로 돌아오면 풀린다)", () => {
      render(
        <ListDiffSplit variant="cards" list={<div>list</div>} detail={<div>diff</div>} files={makeFiles("a")} />,
      );
      act(() => useUIStore.getState().setDiffMaximized(true));
      act(() => useUIStore.getState().setMaximizedFileListOpen(false));
      expect(useUIStore.getState().maximizedFileListOpen).toBe(false);
      act(() => useUIStore.getState().setDiffMaximized(false));
      expect(useUIStore.getState().maximizedFileListOpen).toBe(true);
    });
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

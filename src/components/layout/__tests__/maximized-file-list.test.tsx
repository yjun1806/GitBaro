// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect } from "react";
import i18n from "@/i18n/config";
import { useUIStore } from "@/stores/ui";
import { DiffHeader } from "@/components/diff/DiffHeader";
import { ListDiffSplit } from "../ListDiffSplit";
import type { MaximizedFiles } from "../maximized-files";
import { workingFileItems, parseWorkingFileKey, workingFileKey } from "@/components/commit/working-files";
import type { StatusEntry } from "@/types";

// jsdom has no scrollIntoView; the list's keyboard nav scrolls the picked row into view.
Element.prototype.scrollIntoView = vi.fn();

let detailMounts = 0;
function Detail() {
  useEffect(() => {
    detailMounts++;
  }, []);
  return (
    <DiffHeader
      filePath="src/a.ts"
      status="modified"
      addedLines={1}
      removedLines={0}
      viewMode="unified"
      modes={["unified", "split"]}
      onSelectMode={() => {}}
      maximizable
    />
  );
}

function files(onSelect = vi.fn(), onContextMenu?: MaximizedFiles["onContextMenu"]): MaximizedFiles {
  return {
    items: [
      { key: "a", path: "src/a.ts", status: "modified", additions: 3, deletions: 1 },
      { key: "b", path: "README.md", status: "added", additions: 10, deletions: 0 },
    ],
    selectedKey: "a",
    onSelect,
    onContextMenu,
  };
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  detailMounts = 0;
  useUIStore.setState({ isDiffMaximized: false, maximizedFileListOpen: true });
});
afterEach(cleanup);

describe("maximized diff file list", () => {
  it("appears only while the diff is maximized, with the source list's rows and selection", () => {
    render(<ListDiffSplit variant="cards" list={<div>list</div>} detail={<Detail />} files={files()} />);
    expect(screen.queryByTestId("maximized-file-list")).toBeNull();
    act(() => useUIStore.getState().setDiffMaximized(true));
    const nav = screen.getByTestId("maximized-file-list");
    const rows = within(nav).getAllByRole("button");
    expect(rows.map((r) => r.getAttribute("title"))).toEqual(["src/a.ts", "README.md"]);
    expect(rows[0].getAttribute("aria-current")).toBe("true");
    expect(rows[1].getAttribute("aria-current")).toBeNull();
    expect(within(rows[0]).getByText("+3")).toBeTruthy();
    expect(within(rows[0]).getByText("−1")).toBeTruthy();
    // 0줄은 적지 않는다.
    expect(within(rows[1]).queryByText("−0")).toBeNull();
  });

  it("switches file through the source list's selection", () => {
    const onSelect = vi.fn();
    useUIStore.setState({ isDiffMaximized: true });
    render(<ListDiffSplit variant="inline" list={<div>list</div>} detail={<Detail />} files={files(onSelect)} />);
    fireEvent.click(screen.getByTitle("README.md"));
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("moves with the arrow keys", () => {
    const onSelect = vi.fn();
    useUIStore.setState({ isDiffMaximized: true });
    render(<ListDiffSplit variant="inline" list={<div>list</div>} detail={<Detail />} files={files(onSelect)} />);
    const scroller = screen.getByTestId("maximized-file-list").querySelector("[tabindex='0']")!;
    fireEvent.keyDown(scroller, { key: "ArrowDown" });
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("opens the source list's menu on right-click", () => {
    const onContextMenu = vi.fn();
    useUIStore.setState({ isDiffMaximized: true });
    render(
      <ListDiffSplit variant="inline" list={<div>list</div>} detail={<Detail />} files={files(vi.fn(), onContextMenu)} />,
    );
    fireEvent.contextMenu(screen.getByTitle("src/a.ts"));
    expect(onContextMenu).toHaveBeenCalledWith("a", expect.anything());
  });

  it("is toggled from the diff header and remembered, without remounting the diff", () => {
    render(<ListDiffSplit variant="cards" list={<div>list</div>} detail={<Detail />} files={files()} />);
    // 크게 보기 전에는 목록 버튼이 없다.
    expect(screen.queryByRole("button", { name: "Hide file list" })).toBeNull();
    act(() => useUIStore.getState().setDiffMaximized(true));
    fireEvent.click(screen.getByRole("button", { name: "Hide file list" }));
    expect(screen.queryByTestId("maximized-file-list")).toBeNull();
    expect(useUIStore.getState().maximizedFileListOpen).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Show file list" }));
    expect(screen.getByTestId("maximized-file-list")).toBeTruthy();
    expect(detailMounts).toBe(1);
  });

  it("offers no list toggle when the screen has no file list to show", () => {
    useUIStore.setState({ isDiffMaximized: true });
    render(<ListDiffSplit variant="cards" list={<div>list</div>} detail={<Detail />} />);
    expect(screen.queryByTestId("maximized-file-list")).toBeNull();
    expect(screen.queryByRole("button", { name: "Hide file list" })).toBeNull();
    expect(screen.getByRole("button", { name: "Restore size" })).toBeTruthy();
  });
});

describe("workingFileItems", () => {
  const entry = (path: string, staged: boolean, status: StatusEntry["status"] = "modified"): StatusEntry => ({
    path,
    staged,
    status,
    insertions: 2,
    deletions: 1,
  });

  it("lists staged rows first, then unstaged, folder by folder like the staging list", () => {
    const items = workingFileItems(
      [entry("src/b.ts", false), entry("a.ts", false), entry("src/b.ts", true), entry("lib/c.ts", true)],
      { staged: "Staged", unstaged: "Changes" },
    );
    expect(items.map((i) => [i.group, i.path])).toEqual([
      ["Staged", "lib/c.ts"],
      ["Staged", "src/b.ts"],
      ["Changes", "a.ts"],
      ["Changes", "src/b.ts"],
    ]);
    // 일부만 스테이징한 파일은 두 행이 서로 다른 key를 갖는다.
    expect(new Set(items.map((i) => i.key)).size).toBe(4);
  });

  it("round-trips the row key, including paths with colons", () => {
    expect(parseWorkingFileKey(workingFileKey("a:b.ts", true))).toEqual({ path: "a:b.ts", staged: true });
    expect(parseWorkingFileKey(workingFileKey("x.ts", false))).toEqual({ path: "x.ts", staged: false });
  });
});

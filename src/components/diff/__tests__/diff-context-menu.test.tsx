// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DiffFile } from "@git-diff-view/core";
import i18n from "@/i18n/config";

// jsdom은 레이아웃이 없어 가상 목록이 행을 하나도 그리지 않는다. 모든 행을 그리게 한다.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 21 })),
    getTotalSize: () => count * 21,
    measureElement: () => {},
    measurementsCache: [],
    scrollToIndex: vi.fn(),
  }),
}));
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const invoke = vi.fn(async (..._args: unknown[]) => undefined as unknown);
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { VirtualizedDiffView } = await import("../VirtualizedDiffView");
const { DiffContextMenu } = await import("../DiffContextMenu");

const OLD = "a\nb\nc\n";
const NEW = "a\nB\nc\n";
const PATCH = ["--- a/f.ts", "+++ b/f.ts", "@@ -1,3 +1,3 @@", " a", "-b", "+B", " c"].join("\n");

function buildFile() {
  const file = new DiffFile("f.ts", OLD, "f.ts", NEW, [PATCH], "typescript", "typescript");
  file.initRaw();
  file.buildUnifiedDiffLines();
  file.buildSplitDiffLines();
  return file;
}

const writeText = vi.fn(async (_text: string) => {});
beforeEach(async () => {
  await i18n.changeLanguage("en");
  invoke.mockClear();
  writeText.mockClear();
  Object.assign(navigator, { clipboard: { writeText } });
});
afterEach(cleanup);

describe("diff line right-click", () => {
  it.each([
    ["unified", "B", { text: "B", lineNumber: 2, side: "new", editorLine: 2 }],
    // 지운 줄은 지운 자리 바로 뒤의 새 쪽 줄(B, 2행)에서 편집기를 연다.
    ["unified", "b", { text: "b", lineNumber: 2, side: "old", editorLine: 2 }],
  ] as const)("reports the %s line under the pointer (%s)", (mode, text, expected) => {
    const onLineContextMenu = vi.fn();
    render(
      <VirtualizedDiffView
        diffFile={buildFile()}
        viewMode={mode}
        isDark={false}
        highlight={false}
        fontSize={12}
        onLineContextMenu={onLineContextMenu}
      />,
    );
    fireEvent.contextMenu(screen.getAllByText(text)[0]);
    expect(onLineContextMenu).toHaveBeenCalledWith(expected, expect.anything());
  });

  it("tells the old and new side apart in split view", () => {
    const onLineContextMenu = vi.fn();
    render(
      <VirtualizedDiffView
        diffFile={buildFile()}
        viewMode="split"
        isDark={false}
        highlight={false}
        fontSize={12}
        onLineContextMenu={onLineContextMenu}
      />,
    );
    fireEvent.contextMenu(screen.getAllByText("b")[0]);
    expect(onLineContextMenu).toHaveBeenLastCalledWith({ text: "b", lineNumber: 2, side: "old", editorLine: 2 }, expect.anything());
    fireEvent.contextMenu(screen.getAllByText("B")[0]);
    expect(onLineContextMenu).toHaveBeenLastCalledWith({ text: "B", lineNumber: 2, side: "new", editorLine: 2 }, expect.anything());
  });
});

describe("diff line number double-click", () => {
  // 1–2행을 지우고 끝에 한 줄을 더했다: 옛 쪽 a·b 는 새 쪽에 없다.
  const OLD2 = "a\nb\nc\n";
  const NEW2 = "c\nd\n";
  const PATCH2 = ["--- a/g.ts", "+++ b/g.ts", "@@ -1,3 +1,2 @@", "-a", "-b", " c", "+d"].join("\n");
  function buildFile2() {
    const file = new DiffFile("g.ts", OLD2, "g.ts", NEW2, [PATCH2], "typescript", "typescript");
    file.initRaw();
    file.buildUnifiedDiffLines();
    file.buildSplitDiffLines();
    return file;
  }
  function renderView(mode: "unified" | "split", onLineNumberDoubleClick = vi.fn()) {
    const utils = render(
      <VirtualizedDiffView
        diffFile={buildFile2()}
        viewMode={mode}
        isDark={false}
        highlight={false}
        fontSize={12}
        onLineNumberDoubleClick={onLineNumberDoubleClick}
      />,
    );
    return { ...utils, onLineNumberDoubleClick };
  }
  /** `text` 줄이 있는 행에서 `side` 번호 칸. */
  function numberCell(container: HTMLElement, text: string, side: "old" | "new") {
    const row = screen.getAllByText(text)[0].closest("[data-index]")!;
    const cell = row.querySelector(`[data-line-no="${side}"]`);
    expect(cell, `${text} ${side}`).toBeTruthy();
    expect(container.contains(cell)).toBe(true);
    return cell!;
  }

  it("opens the new-side line number as is", () => {
    const { container, onLineNumberDoubleClick } = renderView("unified");
    fireEvent.doubleClick(numberCell(container, "d", "new"));
    expect(onLineNumberDoubleClick).toHaveBeenCalledWith({ text: "d", lineNumber: 2, side: "new", editorLine: 2 });
  });

  it("maps a deleted line to the new line right after the deletion", () => {
    const { container, onLineNumberDoubleClick } = renderView("unified");
    fireEvent.doubleClick(numberCell(container, "a", "old"));
    expect(onLineNumberDoubleClick).toHaveBeenLastCalledWith({ text: "a", lineNumber: 1, side: "old", editorLine: 1 });
  });

  it("maps the old side in split view the same way", () => {
    const { container, onLineNumberDoubleClick } = renderView("split");
    fireEvent.doubleClick(numberCell(container, "b", "old"));
    expect(onLineNumberDoubleClick).toHaveBeenLastCalledWith({ text: "b", lineNumber: 2, side: "old", editorLine: 1 });
  });

  it("leaves double-clicks on the code itself alone (word selection)", () => {
    const { onLineNumberDoubleClick } = renderView("unified");
    fireEvent.doubleClick(screen.getAllByText("d")[0]);
    expect(onLineNumberDoubleClick).not.toHaveBeenCalled();
  });

  it("falls back to the line before when the end of the file was deleted", () => {
    const file = new DiffFile("h.ts", "a\nb\n", "h.ts", "a\n", [["--- a/h.ts", "+++ b/h.ts", "@@ -1,2 +1,1 @@", " a", "-b"].join("\n")], "typescript", "typescript");
    file.initRaw();
    file.buildUnifiedDiffLines();
    const onLineNumberDoubleClick = vi.fn();
    render(
      <VirtualizedDiffView
        diffFile={file}
        viewMode="unified"
        isDark={false}
        highlight={false}
        fontSize={12}
        onLineNumberDoubleClick={onLineNumberDoubleClick}
      />,
    );
    const row = screen.getAllByText("b")[0].closest("[data-index]")!;
    fireEvent.doubleClick(row.querySelector('[data-line-no="old"]')!);
    expect(onLineNumberDoubleClick).toHaveBeenCalledWith({ text: "b", lineNumber: 2, side: "old", editorLine: 1 });
  });
});

describe("DiffContextMenu", () => {
  it("copies the selection and the line, and opens the file in the editor", () => {
    const props = {
      selection: "a\nB",
      line: { text: "B", lineNumber: 2, side: "new" as const, editorLine: 2 },
      filePath: "src/f.ts",
      repoPath: "/r",
      position: { x: 0, y: 0 },
      onClose: vi.fn(),
    };
    render(<DiffContextMenu {...props} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy" }));
    expect(writeText).toHaveBeenLastCalledWith("a\nB");
    cleanup();
    render(<DiffContextMenu {...props} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy line 2" }));
    expect(writeText).toHaveBeenLastCalledWith("B");
    cleanup();
    render(<DiffContextMenu {...props} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "Open file in editor" }));
    expect(invoke).toHaveBeenCalledWith("open_in_editor", { repoPath: "/r", filePath: "src/f.ts" });
    cleanup();
    render(<DiffContextMenu {...props} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "Open line 2 in editor" }));
    expect(invoke).toHaveBeenLastCalledWith("open_in_editor", { repoPath: "/r", filePath: "src/f.ts", line: 2 });
  });

  it("offers the line only when there is a new-side line to open", () => {
    render(
      <DiffContextMenu
        selection=""
        line={{ text: "gone", lineNumber: 1, side: "old", editorLine: null }}
        filePath="src/f.ts"
        repoPath="/r"
        position={{ x: 0, y: 0 }}
        onClose={vi.fn()}
      />,
    );
    const labels = screen.getAllByRole("menuitem").map((m) => m.textContent);
    expect(labels).toContain("Open file in editor");
    expect(labels.some((l) => l?.startsWith("Open line"))).toBe(false);
  });

  it("names the line in Korean", async () => {
    await i18n.changeLanguage("ko");
    render(
      <DiffContextMenu
        selection=""
        line={{ text: "B", lineNumber: 2, side: "new", editorLine: 2 }}
        filePath="src/f.ts"
        repoPath="/r"
        position={{ x: 0, y: 0 }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("menuitem", { name: "편집기에서 2번 줄 열기" })).toBeTruthy();
  });

  it("leaves out selection and editor items when there is nothing to use them on", () => {
    render(
      <DiffContextMenu
        selection=""
        line={null}
        filePath="src/f.ts"
        repoPath={null}
        position={{ x: 0, y: 0 }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Copy relative path"]);
  });
});

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
    ["unified", "B", { text: "B", lineNumber: 2, side: "new" }],
    ["unified", "b", { text: "b", lineNumber: 2, side: "old" }],
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
    expect(onLineContextMenu).toHaveBeenLastCalledWith({ text: "b", lineNumber: 2, side: "old" }, expect.anything());
    fireEvent.contextMenu(screen.getAllByText("B")[0]);
    expect(onLineContextMenu).toHaveBeenLastCalledWith({ text: "B", lineNumber: 2, side: "new" }, expect.anything());
  });
});

describe("DiffContextMenu", () => {
  it("copies the selection and the line, and opens the file in the editor", () => {
    const props = {
      selection: "a\nB",
      line: { text: "B", lineNumber: 2, side: "new" as const },
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

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18n from "@/i18n/config";
import type { DiffOutput } from "@/types";

// jsdom은 레이아웃이 없어 가상 목록이 행을 하나도 그리지 않는다. 모든 행을 그리게 하고
// 찾기가 부르는 scrollToIndex를 기록한다.
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
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));

const { DiffViewer } = await import("../DiffViewer");
const { useUIStore } = await import("@/stores/ui");
const { useDiffMaximizeEscape } = await import("@/components/layout/useDiffMaximize");
const { FIND_DEBOUNCE_MS } = await import("../use-diff-find");

// 3행의 foo를 Foo로 바꿨다. 옛 쪽·새 쪽을 모두 세면 foo는 3개(대소문자 무시)다:
// 1행 "foo one", 지운 3행 "foo", 더한 3행 "Foo".
const OLD = "foo one\ntwo\nfoo\nfour\n";
const NEW = "foo one\ntwo\nFoo\nfour\n";
const DIFF: DiffOutput = {
  filePath: "src/a.ts",
  oldContent: OLD,
  newContent: NEW,
  binary: false,
  hunks: [
    {
      oldStart: 1,
      oldLines: 4,
      newStart: 1,
      newLines: 4,
      header: "@@ -1,4 +1,4 @@",
      lines: [
        { content: "foo one", lineType: "context", oldLineNo: 1, newLineNo: 1 },
        { content: "two", lineType: "context", oldLineNo: 2, newLineNo: 2 },
        { content: "foo", lineType: "delete", oldLineNo: 3, newLineNo: null },
        { content: "Foo", lineType: "add", oldLineNo: null, newLineNo: 3 },
        { content: "four", lineType: "context", oldLineNo: 4, newLineNo: 4 },
      ],
    },
  ],
};

/** 크게 보기 Escape는 MainLayout이 건다 — 같은 조건을 만들려고 함께 띄운다. */
function Harness() {
  useDiffMaximizeEscape();
  return <DiffViewer diff={DIFF} maximizable />;
}

beforeEach(async () => {
  vi.useFakeTimers();
  await i18n.changeLanguage("en");
  scrollToIndex.mockClear();
  useUIStore.setState({ theme: "light", diffLineMode: "unified", isDiffMaximized: false });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function openFromHeader() {
  fireEvent.click(screen.getByRole("button", { name: "Find in diff (⌘F)" }));
  return screen.getByRole("textbox", { name: "Find in diff" }) as HTMLInputElement;
}

function type(input: HTMLInputElement, value: string) {
  fireEvent.change(input, { target: { value } });
  act(() => {
    vi.advanceTimersByTime(FIND_DEBOUNCE_MS);
  });
}

const status = () => screen.getByRole("search").querySelector("[aria-live]")!.textContent;

describe("diff find bar", () => {
  it("opens from the header button with the input focused", () => {
    render(<Harness />);
    const input = openFromHeader();
    expect(document.activeElement).toBe(input);
  });

  it("counts matches on both sides, ignoring case by default", () => {
    render(<Harness />);
    const input = openFromHeader();
    type(input, "foo");
    expect(status()).toBe("1 / 3");
  });

  it("counts only exact case when case-sensitive is on", () => {
    render(<Harness />);
    const input = openFromHeader();
    type(input, "foo");
    fireEvent.click(screen.getByRole("button", { name: "Match case" }));
    act(() => {
      vi.advanceTimersByTime(FIND_DEBOUNCE_MS);
    });
    expect(status()).toBe("1 / 2");
  });

  it("waits for typing to settle before searching", () => {
    render(<Harness />);
    const input = openFromHeader();
    fireEvent.change(input, { target: { value: "foo" } });
    expect(status()).toBe("");
    act(() => {
      vi.advanceTimersByTime(FIND_DEBOUNCE_MS);
    });
    expect(status()).toBe("1 / 3");
  });

  it("steps with Enter / Shift+Enter and the arrow buttons, wrapping at both ends", () => {
    render(<Harness />);
    const input = openFromHeader();
    type(input, "foo");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(status()).toBe("2 / 3");
    fireEvent.click(screen.getByRole("button", { name: "Next match (Enter)" }));
    expect(status()).toBe("3 / 3");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(status()).toBe("1 / 3");
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(status()).toBe("3 / 3");
    fireEvent.click(screen.getByRole("button", { name: "Previous match (Shift+Enter)" }));
    expect(status()).toBe("2 / 3");
  });

  it("scrolls the list to the row of the current match", () => {
    render(<Harness />);
    const input = openFromHeader();
    type(input, "four");
    // 행 0은 hunk 머리, 1–5가 줄이다. four는 마지막 줄(행 5).
    expect(scrollToIndex).toHaveBeenLastCalledWith(5, { align: "center" });
  });

  it("says so when nothing matches", () => {
    render(<Harness />);
    type(openFromHeader(), "zzz");
    expect(status()).toBe("No results");
    expect((screen.getByRole("button", { name: "Next match (Enter)" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("closes on Escape without leaving the maximized diff", () => {
    useUIStore.setState({ isDiffMaximized: true });
    render(<Harness />);
    const input = openFromHeader();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("search")).toBeNull();
    expect(useUIStore.getState().isDiffMaximized).toBe(true);
    // 찾기 칸이 닫힌 뒤의 Escape는 원래대로 크게 보기를 끝낸다.
    fireEvent.keyDown(document.activeElement ?? window, { key: "Escape" });
    expect(useUIStore.getState().isDiffMaximized).toBe(false);
  });

  it("opens with ⌘F while focus is inside the diff", () => {
    render(<Harness />);
    const root = document.querySelector<HTMLElement>("[data-diff-viewer]")!;
    root.focus();
    fireEvent.keyDown(root, { key: "f", metaKey: true });
    expect(screen.getByRole("search")).toBeTruthy();
  });

  it("leaves ⌘F alone when typing in another field and a second diff is on screen", () => {
    render(
      <>
        <input aria-label="other" />
        <DiffViewer diff={DIFF} />
        <DiffViewer diff={DIFF} />
      </>,
    );
    const other = screen.getByRole("textbox", { name: "other" });
    other.focus();
    fireEvent.keyDown(other, { key: "f", metaKey: true });
    expect(screen.queryByRole("search")).toBeNull();
  });
});

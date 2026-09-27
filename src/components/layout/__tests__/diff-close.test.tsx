// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18n from "@/i18n/config";
import { useUIStore } from "@/stores/ui";
import { DiffHeader } from "@/components/diff/DiffHeader";
import { ListDiffSplit } from "../ListDiffSplit";
import { usePaneStore } from "../pane-state";
import { useDiffMaximizeEscape } from "../useDiffMaximize";

Element.prototype.scrollIntoView = () => {};

/** 파일 두 개짜리 목록 + diff. 닫으면 파일 선택만 풀린다(1단계). */
function Screen() {
  useDiffMaximizeEscape();
  const [selected, setSelected] = useState<string | null>("a");
  return (
    <ListDiffSplit
      variant="cards"
      list={<input aria-label="message" />}
      files={{
        items: [
          { key: "a", path: "src/a.ts", status: "modified" },
          { key: "b", path: "src/b.ts", status: "added" },
        ],
        selectedKey: selected,
        onSelect: setSelected,
      }}
      onCloseFile={() => setSelected(null)}
      detail={
        <DiffHeader
          filePath={`src/${selected}.ts`}
          status="modified"
          addedLines={1}
          removedLines={0}
          viewMode="unified"
          modes={["unified"]}
          onSelectMode={() => {}}
          maximizable
        />
      }
    />
  );
}

const escape = (target: EventTarget = document.body) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });

beforeEach(async () => {
  await i18n.changeLanguage("en");
  useUIStore.setState({ isDiffMaximized: false, diffFileOpen: false });
  usePaneStore.setState({ diffClosers: [] });
});
afterEach(cleanup);

describe("closing the diff (5.4)", () => {
  it("closes the diff from the X in its header, back to level 1", () => {
    render(<Screen />);
    expect(useUIStore.getState().diffFileOpen).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Close the diff" }));
    expect(useUIStore.getState().diffFileOpen).toBe(false);
    expect(screen.queryByRole("button", { name: "Close the diff" })).toBeNull();
  });

  it("steps back one level per Escape: maximized → level 2 → level 1", () => {
    render(<Screen />);
    act(() => useUIStore.getState().setDiffMaximized(true));
    // 크게 보는 동안에는 닫기 버튼이 없다 — 「원래 크기로」가 먼저다.
    expect(screen.queryByRole("button", { name: "Close the diff" })).toBeNull();
    escape();
    expect(useUIStore.getState().isDiffMaximized).toBe(false);
    expect(useUIStore.getState().diffFileOpen).toBe(true);
    escape();
    expect(useUIStore.getState().diffFileOpen).toBe(false);
    // 1단계에서 Esc는 더 닫지 않는다.
    escape();
    expect(usePaneStore.getState().diffClosers).toHaveLength(0);
  });

  it("ignores Escape while typing in the list, or while a menu is open", () => {
    render(<Screen />);
    escape(screen.getByLabelText("message"));
    expect(useUIStore.getState().diffFileOpen).toBe(true);
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.appendChild(menu);
    try {
      escape();
      expect(useUIStore.getState().diffFileOpen).toBe(true);
    } finally {
      menu.remove();
    }
  });
});

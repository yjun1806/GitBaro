// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";

describe("useListKeyboardNav", () => {
  it("따라간다: 밖에서 selectedIndex가 지워지면(-1) activeIndex도 따라서 지워진다", () => {
    // GraphPanel: 커밋 C3를 고른 뒤(activeIndex=2) "커밋하지 않은 변경" 행을 누르면
    // selectedCommitId가 null이 되어 selectedIndex가 -1이 된다. C3 강조가 남으면 안 된다.
    const { result, rerender } = renderHook(
      ({ selectedIndex }) =>
        useListKeyboardNav({ items: ["a", "b", "c"], onSelect: () => {}, selectedIndex }),
      { initialProps: { selectedIndex: 2 } },
    );

    expect(result.current.activeIndex).toBe(2);

    rerender({ selectedIndex: -1 });
    expect(result.current.activeIndex).toBe(-1);
  });

  it("마우스 클릭 등으로 selectedIndex가 바뀌면 activeIndex가 그대로 따라간다", () => {
    const { result, rerender } = renderHook(
      ({ selectedIndex }) =>
        useListKeyboardNav({ items: ["a", "b", "c"], onSelect: () => {}, selectedIndex }),
      { initialProps: { selectedIndex: 0 } },
    );

    rerender({ selectedIndex: 1 });
    expect(result.current.activeIndex).toBe(1);
  });

  it("selectedIndex를 안 주면(기본 -1) activeIndex도 -1로 시작한다", () => {
    const { result } = renderHook(() =>
      useListKeyboardNav({ items: ["a", "b"], onSelect: () => {} }),
    );
    expect(result.current.activeIndex).toBe(-1);
  });

  it("방향키를 누르면 다음 항목을 고르고 activeIndex를 옮긴다", () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() =>
      useListKeyboardNav({ items: ["a", "b", "c"], onSelect, selectedIndex: -1 }),
    );

    result.current.containerProps.onKeyDown({
      key: "ArrowDown",
      preventDefault: () => {},
      target: { tagName: "DIV" },
    } as unknown as React.KeyboardEvent);

    expect(onSelect).toHaveBeenCalledWith("a", 0);
  });
});

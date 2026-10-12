import { useState, useCallback, useRef, useEffect } from "react";

interface UseListKeyboardNavOptions<T> {
  items: T[];
  onSelect: (item: T, index: number) => void;
  selectedIndex?: number;
  enabled?: boolean;
  /**
   * 목록이 가상화돼 활성 행이 DOM에 없을 수 있을 때 쓴다. 주면 행 요소의 `scrollIntoView` 대신
   * 이 함수가 활성 행을 보이게 한다.
   */
  scrollToIndex?: (index: number) => void;
}

interface UseListKeyboardNavReturn {
  activeIndex: number;
  setActiveIndex: (i: number) => void;
  containerProps: {
    tabIndex: number;
    onKeyDown: (e: React.KeyboardEvent) => void;
    style: React.CSSProperties;
  };
  itemRef: (index: number) => (el: HTMLElement | null) => void;
}

export function useListKeyboardNav<T>({
  items,
  onSelect,
  selectedIndex = -1,
  enabled = true,
  scrollToIndex,
}: UseListKeyboardNavOptions<T>): UseListKeyboardNavReturn {
  const [activeIndex, setActiveIndex] = useState(-1);
  const itemRefs = useRef<Map<number, HTMLElement>>(new Map());
  const scrollToIndexRef = useRef(scrollToIndex);
  useEffect(() => {
    scrollToIndexRef.current = scrollToIndex;
  });

  // Sync activeIndex when selected item changes (e.g. mouse click, or the
  // selection being cleared to -1 elsewhere — e.g. switching to the
  // "uncommitted changes" row). Every arrow-key move also calls onSelect, so
  // selectedIndex tracks activeIndex closely; always mirroring it here (not
  // only when >= 0) keeps a cleared selection from leaving a stale highlight.
  useEffect(() => {
    setActiveIndex(selectedIndex);
  }, [selectedIndex]);

  // Clamp activeIndex when items change
  useEffect(() => {
    setActiveIndex((i) => (items.length === 0 ? -1 : Math.min(i, items.length - 1)));
  }, [items.length]);

  // Scroll into view when activeIndex changes
  useEffect(() => {
    if (activeIndex < 0) return;
    if (scrollToIndexRef.current) {
      scrollToIndexRef.current(activeIndex);
      return;
    }
    const el = itemRefs.current.get(activeIndex);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!enabled || items.length === 0) return;

      // Ignore when focus is on input/textarea
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      let nextIndex = -1;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        // Start from selected item if no active keyboard position
        const base = activeIndex >= 0 ? activeIndex : selectedIndex;
        nextIndex = base < 0 ? 0 : (base + 1) % items.length;
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const base = activeIndex >= 0 ? activeIndex : selectedIndex;
        nextIndex = base <= 0 ? items.length - 1 : base - 1;
      }

      if (nextIndex >= 0) {
        setActiveIndex(nextIndex);
        onSelect(items[nextIndex], nextIndex);
      }
    },
    [enabled, items, activeIndex, selectedIndex, onSelect],
  );

  const itemRef = useCallback(
    (index: number) => (el: HTMLElement | null) => {
      if (el) {
        itemRefs.current.set(index, el);
      } else {
        itemRefs.current.delete(index);
      }
    },
    [],
  );

  return {
    activeIndex,
    setActiveIndex,
    containerProps: {
      tabIndex: 0,
      onKeyDown: handleKeyDown,
      style: { outline: "none" },
    },
    itemRef,
  };
}

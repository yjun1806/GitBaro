import { useState, useCallback, useRef, useEffect } from "react";

interface UseListKeyboardNavOptions<T> {
  items: T[];
  onSelect: (item: T, index: number) => void;
  selectedIndex?: number;
  enabled?: boolean;
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
}: UseListKeyboardNavOptions<T>): UseListKeyboardNavReturn {
  const [activeIndex, setActiveIndex] = useState(-1);
  const itemRefs = useRef<Map<number, HTMLElement>>(new Map());

  // Sync activeIndex when selected item changes (e.g. mouse click)
  useEffect(() => {
    if (selectedIndex >= 0) {
      setActiveIndex(selectedIndex);
    }
  }, [selectedIndex]);

  // Clamp activeIndex when items change
  useEffect(() => {
    if (items.length === 0) {
      setActiveIndex(-1);
    } else if (activeIndex >= items.length) {
      setActiveIndex(items.length - 1);
    }
  }, [items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll into view when activeIndex changes
  useEffect(() => {
    if (activeIndex < 0) return;
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

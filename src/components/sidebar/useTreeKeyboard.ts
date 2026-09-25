import { useCallback, useEffect, type FocusEvent, type KeyboardEvent, type RefObject } from "react";

const ITEM = '[role="treeitem"]';

function treeItems(tree: HTMLElement): HTMLElement[] {
  return Array.from(tree.querySelectorAll<HTMLElement>(ITEM));
}

function levelOf(item: HTMLElement): number {
  return Number(item.getAttribute("aria-level") ?? "1");
}

/** `item` 하나만 Tab으로 닿게 한다(나머지는 -1). */
function makeTabStop(items: readonly HTMLElement[], item: HTMLElement): void {
  for (const el of items) el.tabIndex = el === item ? 0 : -1;
}

/**
 * ARIA 트리 키보드 조작(roving tabindex). 트리 전체가 Tab 한 번에 들어오고 나가며, 안에서는
 * ↑/↓로 앞뒤 줄, Home/End로 처음·끝 줄, ←로 부모 줄, →로 첫 자식 줄로 옮긴다.
 * 접고 펴기(펼친 줄의 ←, 접힌 줄의 →)는 행(`TreeRowFrame`)이 먼저 처리한다.
 *
 * 행은 `tabIndex={-1}`로 그리고, 이 훅이 초점을 받은 줄(없으면 선택된 줄, 그것도 없으면 첫 줄)
 * 하나에만 0을 준다. 줄이 새로 생기거나 사라져도 렌더마다 다시 맞춘다.
 */
export function useTreeKeyboard(treeRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const tree = treeRef.current;
    if (!tree) return;
    const items = treeItems(tree);
    if (items.length === 0) return;
    const active = document.activeElement;
    const current =
      items.find((el) => el === active) ??
      items.find((el) => el.tabIndex === 0) ??
      items.find((el) => el.getAttribute("aria-selected") === "true") ??
      items[0];
    makeTabStop(items, current);
  });

  const onFocus = useCallback(
    (e: FocusEvent<HTMLElement>) => {
      const tree = treeRef.current;
      const target = e.target as HTMLElement;
      if (tree && target.matches(ITEM)) makeTabStop(treeItems(tree), target);
    },
    [treeRef],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      const tree = treeRef.current;
      const target = e.target as HTMLElement;
      if (!tree || e.defaultPrevented || !target.matches(ITEM)) return;
      const items = treeItems(tree);
      const i = items.indexOf(target);
      if (i < 0) return;
      const level = levelOf(target);
      let next: HTMLElement | undefined;
      switch (e.key) {
        case "ArrowDown":
          next = items[i + 1];
          break;
        case "ArrowUp":
          next = items[i - 1];
          break;
        case "Home":
          next = items[0];
          break;
        case "End":
          next = items[items.length - 1];
          break;
        case "ArrowLeft":
          // 접힌 줄(또는 접을 수 없는 줄)이면 부모 줄로 간다.
          next = items
            .slice(0, i)
            .reverse()
            .find((el) => levelOf(el) < level);
          break;
        case "ArrowRight":
          // 펼친 줄이면 첫 자식 줄로 간다.
          if (target.getAttribute("aria-expanded") === "true" && items[i + 1] && levelOf(items[i + 1]) > level) {
            next = items[i + 1];
          }
          break;
        default:
          return;
      }
      e.preventDefault();
      if (!next) return;
      makeTabStop(items, next);
      next.focus();
    },
    [treeRef],
  );

  return { onKeyDown, onFocus };
}

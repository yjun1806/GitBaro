import { useCallback, useEffect, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";

const ITEM_SELECTOR = '[role="menuitem"]:not([disabled])';

function enabledItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>(ITEM_SELECTOR));
}

/**
 * Keyboard support for a popup menu whose items are `role="menuitem"` buttons:
 * focus moves to the first item on open, ArrowUp/ArrowDown/Home/End move
 * between enabled items, Enter/Space activate the focused button natively,
 * and Escape or Tab close the menu. `restoreFocus` hands focus back to where
 * it was before the menu opened; Escape and Tab call it themselves, and item
 * handlers should call it before running an action.
 */
export function useMenuKeyboard(
  menuRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  /** 메뉴가 화면에 자리 잡아 보이는 상태인가. false인 동안은 포커스를 미룬다(숨은 요소는 포커스를 받지 않는다). */
  ready = true,
) {
  const [opener] = useState(() =>
    typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null),
  );

  const restoreFocus = useCallback(() => {
    if (opener && opener.isConnected && opener !== document.body) opener.focus();
  }, [opener]);

  useEffect(() => {
    if (!ready) return;
    const menu = menuRef.current;
    if (!menu) return;
    const first = enabledItems(menu)[0];
    (first ?? menu).focus();
  }, [menuRef, ready]);

  // Escape must close the menu even if focus has left it (e.g. after a
  // pointer click on its padding), and must not also close a dialog behind it,
  // so it is caught on the document in the capture phase.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      restoreFocus();
      onClose();
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [onClose, restoreFocus]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    // Keep arrow keys etc. from driving the list the menu was opened from.
    e.stopPropagation();
    const menu = menuRef.current;
    if (!menu) return;
    if (e.key === "Tab") {
      e.preventDefault();
      restoreFocus();
      onClose();
      return;
    }
    const items = enabledItems(menu);
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    switch (e.key) {
      case "ArrowDown":
        next = current < 0 ? 0 : (current + 1) % items.length;
        break;
      case "ArrowUp":
        next = current <= 0 ? items.length - 1 : current - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = items.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    items[next].focus();
  };

  return { onKeyDown, restoreFocus };
}

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";

export interface DialogA11yOptions {
  /** Called on Escape (when `dismissible`). */
  onClose?: () => void;
  /** false while an operation is pending and the panel must not be dismissed. */
  dismissible?: boolean;
}

export interface DialogA11yResult {
  /** Attach to the panel's `onKeyDown`. */
  handleKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Open dialog/popover panels, innermost last. Only the top one reacts to keys that reach the document. */
const panelStack: symbol[] = [];

/**
 * Is a dialog or popover panel open? Window-level shortcuts (⌘F, ⌘\) check this so they don't act
 * on, or pull focus into, the view behind a modal.
 */
export function isDialogOpen(): boolean {
  return panelStack.length > 0;
}

function focusableIn(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.closest("[inert]") && el.getAttribute("aria-hidden") !== "true",
  );
}

/** Keeps Tab / Shift+Tab inside the panel. Returns true when it moved focus itself. */
function trapTab(panel: HTMLElement, shiftKey: boolean): boolean {
  const items = focusableIn(panel);
  if (items.length === 0) {
    panel.focus();
    return true;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (!panel.contains(active)) {
    (shiftKey ? last : first).focus();
    return true;
  }
  if (shiftKey && (active === first || active === panel)) {
    last.focus();
    return true;
  }
  if (!shiftKey && active === last) {
    first.focus();
    return true;
  }
  return false;
}

/**
 * Shared focus-trap / Escape-to-close / focus-return behavior for anything with
 * `role="dialog"` semantics — a modal (`Dialog`) or a popover panel anchored to
 * a trigger button (`AnchoredPanel`). Extracted from `Dialog.tsx` so both share
 * one implementation instead of two copies drifting apart.
 *
 * On mount: focus moves into `panelRef` (unless something inside it already has
 * focus). On unmount: focus returns to whatever had it before the panel opened.
 * While open: Escape calls `onClose` (when `dismissible`), Tab/Shift+Tab is
 * trapped inside the panel, both via the returned `handleKeyDown` and, as a
 * fallback, via a document listener for keys pressed while focus is outside
 * every panel (e.g. right after a backdrop click).
 */
export function useDialogA11y(
  panelRef: RefObject<HTMLElement | null>,
  { onClose, dismissible = true }: DialogA11yOptions,
): DialogA11yResult {
  // Captured during the first render, before any autoFocus child steals focus.
  const [opener] = useState(() =>
    typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null),
  );
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  useEffect(() => {
    onCloseRef.current = onClose;
    dismissibleRef.current = dismissible;
  });

  useEffect(() => {
    const token = Symbol("dialog-a11y");
    panelStack.push(token);

    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) {
      panel.focus();
    }

    const handleDocumentKeyDown = (e: KeyboardEvent) => {
      if (panelStack[panelStack.length - 1] !== token || e.defaultPrevented) return;
      const p = panelRef.current;
      if (!p || p.contains(e.target as Node)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (dismissibleRef.current) onCloseRef.current?.();
      } else if (e.key === "Tab") {
        e.preventDefault();
        trapTab(p, e.shiftKey);
      }
    };
    document.addEventListener("keydown", handleDocumentKeyDown);

    return () => {
      document.removeEventListener("keydown", handleDocumentKeyDown);
      const idx = panelStack.indexOf(token);
      if (idx >= 0) panelStack.splice(idx, 1);
      // Under StrictMode the effect is re-run on a still-mounted panel; only
      // hand focus back once the panel has really left the DOM.
      if (panel?.isConnected) return;
      if (opener && opener.isConnected && opener !== document.body) {
        opener.focus();
      }
    };
  }, [opener, panelRef]);

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    // A modal/popover owns its keys: keep them from reaching list navigation or
    // global shortcuts behind it (and from closing an outer panel).
    e.stopPropagation();
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      if (e.defaultPrevented) return;
      e.preventDefault();
      if (dismissible) onClose?.();
    } else if (e.key === "Tab" && panelRef.current) {
      if (trapTab(panelRef.current, e.shiftKey)) e.preventDefault();
    }
  };

  return { handleKeyDown };
}

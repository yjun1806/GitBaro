import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface DialogProps {
  /** Called on Escape (when `dismissible`) and, if `closeOnBackdrop`, on a backdrop click. Omit for a dialog the user must answer. */
  onClose?: () => void;
  /** id of the element that names the dialog (usually its heading). */
  labelledBy?: string;
  /** Accessible name, for a dialog without a visible heading. */
  ariaLabel?: string;
  /** Classes for the dialog panel itself. */
  className?: string;
  /** Classes for the full-screen backdrop (z-index and tint). */
  overlayClassName?: string;
  /** false while an operation is pending and the dialog must not be dismissed. */
  dismissible?: boolean;
  /** Close when the backdrop (outside the panel) is clicked. */
  closeOnBackdrop?: boolean;
  children: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Open dialogs, innermost last. Only the top one reacts to keys that reach the document. */
const dialogStack: symbol[] = [];

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
 * Modal dialog shell: backdrop + panel with role="dialog", aria-modal and
 * aria-labelledby. Escape closes it, focus moves into it on open and returns
 * to the opener on close, and Tab cycles inside it. Visuals come entirely
 * from `className` / `overlayClassName`.
 */
export function Dialog({
  onClose,
  labelledBy,
  ariaLabel,
  className,
  overlayClassName = "z-50 bg-black/40",
  dismissible = true,
  closeOnBackdrop = false,
  children,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
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
    const token = Symbol("dialog");
    dialogStack.push(token);

    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) {
      panel.focus();
    }

    // Fallback for keys pressed while focus is outside every dialog (e.g. on
    // <body> after a backdrop click). Keys from inside the panel are handled
    // by handleKeyDown and never reach the document.
    const handleDocumentKeyDown = (e: KeyboardEvent) => {
      if (dialogStack[dialogStack.length - 1] !== token || e.defaultPrevented) return;
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
      const idx = dialogStack.indexOf(token);
      if (idx >= 0) dialogStack.splice(idx, 1);
      // Under StrictMode the effect is re-run on a still-mounted panel; only
      // hand focus back once the dialog has really left the DOM.
      if (panel?.isConnected) return;
      if (opener && opener.isConnected && opener !== document.body) {
        opener.focus();
      }
    };
  }, [opener]);

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // A modal owns its keys: keep them from reaching list navigation or
    // global shortcuts behind it (and from closing an outer dialog).
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

  return (
    <div
      className={cn("fixed inset-0 flex items-center justify-center", overlayClassName)}
      onClick={closeOnBackdrop ? () => onClose?.() : undefined}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={ariaLabel}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        onClick={closeOnBackdrop ? (e) => e.stopPropagation() : undefined}
        className={cn("outline-none", className)}
      >
        {children}
      </div>
    </div>
  );
}

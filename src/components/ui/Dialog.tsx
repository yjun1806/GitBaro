import { useRef } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useDialogA11y } from "@/lib/use-dialog-a11y";

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

/**
 * Modal dialog shell: backdrop + panel with role="dialog", aria-modal and
 * aria-labelledby. Escape closes it, focus moves into it on open and returns
 * to the opener on close, and Tab cycles inside it (all via `useDialogA11y`,
 * shared with the anchored popover panel `AnchoredPanel`). Visuals come
 * entirely from `className` / `overlayClassName`.
 */
export function Dialog({
  onClose,
  labelledBy,
  ariaLabel,
  className,
  overlayClassName = "z-50 bg-(--overlay)",
  dismissible = true,
  closeOnBackdrop = false,
  children,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { handleKeyDown } = useDialogA11y(panelRef, { onClose, dismissible });

  return (
    <div
      className={cn("fixed inset-0 flex items-center justify-center animate-overlay-in", overlayClassName)}
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
        className={cn("outline-none animate-dialog-in", className)}
      >
        {children}
      </div>
    </div>
  );
}

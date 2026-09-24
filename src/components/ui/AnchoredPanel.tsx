import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { cn } from "@/lib/utils";
import { useDialogA11y } from "@/lib/use-dialog-a11y";
import { clampPanelToViewport } from "@/lib/panel-position";

export interface AnchoredPanelProps {
  /** The trigger button the panel opens from and is positioned under. */
  anchorRef: RefObject<HTMLElement | null>;
  onClose?: () => void;
  labelledBy?: string;
  ariaLabel?: string;
  /** Classes for the panel itself (size, chrome — position comes from this component). */
  className?: string;
  /** Classes for the full-screen click-outside-to-close layer. Defaults to a transparent layer (no dimming — this is a popover, not a modal). */
  overlayClassName?: string;
  dismissible?: boolean;
  closeOnBackdrop?: boolean;
  children: ReactNode;
}

/**
 * Popover panel shell shared by `BranchPanel` and the worktree panel: it
 * anchors under `anchorRef` (left-edge aligned, clamped to the window with
 * `clampPanelToViewport`) instead of docking to a fixed screen edge, and reuses
 * `Dialog`'s focus-trap / Escape / focus-return behavior via `useDialogA11y` so
 * both panel styles — modal and anchored popover — share one accessibility
 * implementation.
 *
 * Position is measured after mount (`useLayoutEffect`) because the panel's own
 * size depends on its content; until then it renders off-screen so no visible
 * jump/flash occurs at the default position.
 */
export function AnchoredPanel({
  anchorRef,
  onClose,
  labelledBy,
  ariaLabel,
  className,
  overlayClassName = "z-50",
  dismissible = true,
  closeOnBackdrop = true,
  children,
}: AnchoredPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { handleKeyDown } = useDialogA11y(panelRef, { onClose, dismissible });
  const [position, setPosition] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    const update = () => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const a = anchor.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      setPosition(
        clampPanelToViewport(
          { left: a.left, top: a.top, bottom: a.bottom, width: a.width },
          { width: p.width, height: p.height },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [anchorRef]);

  return (
    <div
      className={cn("fixed inset-0", overlayClassName)}
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
        onClick={(e) => e.stopPropagation()}
        // `useLayoutEffect` measures and positions the panel before the browser
        // paints, so in practice this only ever renders visibly once — the
        // (0, 0) fallback exists for environments without real layout (tests)
        // or when `anchorRef` isn't attached to anything yet, and is kept
        // visible/in the accessibility tree rather than hidden behind it.
        //
        // `maxHeight` is the room actually available below (or above) the
        // anchor inside the window — always `<= panel.height` — so the panel
        // never renders past the window's bottom; its header/search stay
        // fixed and its list scrolls to make up the difference (see
        // `clampPanelToViewport`). Once measured it overrides any static
        // `max-h-*` class the caller set for the pre-measurement fallback.
        style={{
          position: "fixed",
          top: position?.top ?? 0,
          left: position?.left ?? 0,
          maxHeight: position ? position.maxHeight : undefined,
        }}
        className={cn("outline-none", className)}
      >
        {children}
      </div>
    </div>
  );
}

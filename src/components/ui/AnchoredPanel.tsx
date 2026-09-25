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
      // 지금 붙은 maxHeight로 줄어든 높이가 아니라 내용 그대로의 높이를 잰다. 그래야 창이 커지거나
      // 내용이 늘었을 때 다시 커진다. 재고 나면 되돌린다(같은 값이면 React가 다시 쓰지 않는다).
      const applied = panel.style.maxHeight;
      panel.style.maxHeight = "";
      const p = panel.getBoundingClientRect();
      panel.style.maxHeight = applied;
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
    // 목록을 읽어 오거나 검색으로 줄면 내용 높이가 바뀐다. 패널 안 요소의 크기 변화로 다시 잰다.
    const panel = panelRef.current;
    const observer =
      panel && typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => update()) : null;
    if (panel && observer) Array.from(panel.children).forEach((child) => observer.observe(child));
    return () => {
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
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
        // anchor inside the window — always `<=` the panel's natural height,
        // measured with `maxHeight` lifted so it can grow back — so the panel
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

/** The trigger button's box, in viewport coordinates (`getBoundingClientRect()`). */
export interface AnchorRect {
  left: number;
  top: number;
  bottom: number;
  width: number;
}

export interface PanelSize {
  width: number;
  height: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface ClampOptions {
  /** Minimum distance kept from every window edge. */
  margin?: number;
  /** Gap between the anchor and the panel. */
  gap?: number;
}

export interface PanelPosition {
  top: number;
  left: number;
}

/**
 * Positions a popover panel just under its trigger button, left-edge aligned,
 * then clamps it so it never runs off any side of the window.
 *
 * - Left: aligned to the anchor's left edge, but pulled back so the panel's
 *   right edge stays inside the viewport, and pushed right so its left edge
 *   never sits inside `margin` of the window's left edge either.
 * - Top: placed below the anchor by `gap`. If it would overflow the bottom of
 *   the viewport, it flips to open *above* the anchor instead — but only when
 *   doing so actually fits; otherwise it stays below and is clamped to the
 *   viewport like any other overflow (better a slightly covered anchor than a
 *   panel pinned off-screen).
 *
 * Pure and side-effect free so it can be unit tested without a DOM.
 */
export function clampPanelToViewport(
  anchor: AnchorRect,
  panel: PanelSize,
  viewport: ViewportSize,
  { margin = 8, gap = 6 }: ClampOptions = {},
): PanelPosition {
  const maxLeft = Math.max(margin, viewport.width - panel.width - margin);
  const left = Math.min(Math.max(anchor.left, margin), maxLeft);

  const belowTop = anchor.bottom + gap;
  const fitsBelow = belowTop + panel.height <= viewport.height - margin;
  const aboveTop = anchor.top - gap - panel.height;
  const fitsAbove = aboveTop >= margin;

  const preferredTop = fitsBelow || !fitsAbove ? belowTop : aboveTop;

  const maxTop = Math.max(margin, viewport.height - panel.height - margin);
  const top = Math.min(Math.max(preferredTop, margin), maxTop);

  return { top, left };
}

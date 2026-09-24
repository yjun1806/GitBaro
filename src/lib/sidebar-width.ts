export const MIN_SIDEBAR_WIDTH = 200;
/** Space the content panel keeps to the right of the sidebar. */
export const MIN_RIGHT_PANEL_WIDTH = 700;

/**
 * Fits a sidebar width into the current window. The stored width can come from
 * a wider screen, and without this the sidebar would cover the content panel
 * and push the resize handle off-screen.
 */
export function clampSidebarWidth(width: number, viewportWidth: number): number {
  const maxWidth = viewportWidth - MIN_RIGHT_PANEL_WIDTH;
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(maxWidth, width));
}

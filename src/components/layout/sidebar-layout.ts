import type { RailMode } from "@/stores/ui";
import { railFlowWidth } from "./RepoRail";

/**
 * Width of the sidebar resize handle between the two columns. It is an
 * invisible grab area (the design has no line there), so it is wider than a
 * hairline to stay easy to hit.
 */
export const SIDEBAR_HANDLE_WIDTH = 6;

/**
 * Where the main column starts, in px from the window's left edge. When the
 * sidebar is pinned open ("expanded") the user sizes it (`sidebarWidth`) and a
 * resize handle follows it. In the other modes the sidebar is a narrow rail
 * that only overlays the main column while hovered. Panels that slide out
 * next to the sidebar (toolbar branch/worktree panels) use this for `left`.
 */
export function mainColumnLeft(railMode: RailMode, sidebarWidth: number): number {
  return railMode === "expanded"
    ? sidebarWidth + SIDEBAR_HANDLE_WIDTH
    : railFlowWidth(railMode);
}

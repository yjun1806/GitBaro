import type { RailMode } from "@/stores/ui";
import { SIDEBAR_HANDLE_WIDTH } from "@/lib/layout-tokens";
import { railFlowWidth } from "./RepoRail";

export { SIDEBAR_HANDLE_WIDTH };

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

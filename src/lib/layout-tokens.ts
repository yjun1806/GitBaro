/**
 * Shared header strip height: the sidebar's top row (`RepoRail`'s "전체
 * 저장소" button) and the toolbar (`ToolbarRoot`) form one continuous top
 * strip and must be the same height for their bottom borders to line up.
 * Kept as a plain constant (not a CSS variable) because it belongs to two
 * different component files, not `globals.css` — see `HEADER_HEIGHT_CLASS`.
 */
export const HEADER_HEIGHT_PX = 44;

/** Tailwind arbitrary-value class for `HEADER_HEIGHT_PX`, kept in one place so it can't drift from the constant above. */
export const HEADER_HEIGHT_CLASS = "h-[44px]";

/**
 * Width reserved for macOS's traffic-light buttons under the app's Overlay
 * title bar (`tauri.conf.json`'s `titleBarStyle`). The inset lives on the
 * sidebar side of the header strip (the window's actual top-left corner),
 * not the toolbar.
 */
export const TRAFFIC_LIGHT_INSET_PX = 78;

/**
 * Width of the sidebar resize handle between the sidebar and the main column.
 * It is an invisible, frame-colored grab area, so it reads as part of the
 * sidebar's right gutter — see `SIDEBAR_GUTTER_PX`.
 */
export const SIDEBAR_HANDLE_WIDTH = 6;

/**
 * Sidebar content gutter (left and right). When the pinned sidebar has the
 * resize handle on its right, the content's right padding is reduced by the
 * handle width so both gutters look the same.
 */
export const SIDEBAR_GUTTER_PX = 10;

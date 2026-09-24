import { useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useUIStore } from "@/stores/ui";
import { useAutoSync } from "@/hooks/useAutoSync";
import { useLiveChanges } from "@/hooks/useLiveChanges"; // W1-T3
import { useSidebarWidth } from "@/hooks/useSidebarWidth";
import "@/stores/selection"; // ensure cross-store subscriptions are registered
import { RepoRail } from "./RepoRail";
import { MainColumn } from "./MainColumn";
import { SIDEBAR_HANDLE_WIDTH } from "./sidebar-layout";
import { StatusBar } from "./StatusBar";
import { ActivityLogPanel } from "./ActivityLogPanel";
import { AutoSyncSettingsDialogHost } from "@/components/repository/AutoSyncSettingsDialog";
import { clampSidebarWidth } from "@/lib/sidebar-width";
import { cn } from "@/lib/utils";

/**
 * Two-column shell from the design (`gen_d.py` `frame(side, main)`):
 * [sidebar | main column]. The main column holds the toolbar, the graph panel
 * and the file list + diff.
 */
export function MainLayout() {
  const { t } = useTranslation();
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const railMode = useUIStore((s) => s.railMode);
  const isActivityLogOpen = useUIStore((s) => s.isActivityLogOpen);

  // 저장소별 설정에 따라 원격을 주기적으로 확인하고, 안전할 때만 자동으로 받는다
  useAutoSync();
  // 여러 저장소·워크트리의 파일 변경 시각을 모은다("지금 바뀌는 곳" 등에 씀)
  useLiveChanges();

  const sidebarWidth = useSidebarWidth();
  // 사이드바를 고정으로 펼친 모드에서만 폭을 사용자가 조절한다. 접힘·hover 모드는
  // 좁은 레일로 남는다(hover는 레일 위에 떠서 펼쳐진다).
  const isResizable = railMode === "expanded";

  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(sidebarWidth);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      isDragging.current = true;
      startX.current = e.clientX;
      startWidth.current = sidebarWidth;

      const onMouseMove = (ev: MouseEvent) => {
        if (!isDragging.current) return;
        const delta = ev.clientX - startX.current;
        setSidebarWidth(
          clampSidebarWidth(startWidth.current + delta, window.innerWidth),
        );
      };

      const onMouseUp = () => {
        isDragging.current = false;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [sidebarWidth, setSidebarWidth],
  );

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar. When pinned open it takes the user-sized width: the rail's
            own fixed widths are stretched to fill this slot. */}
        <div
          data-testid="sidebar-slot"
          style={isResizable ? { width: sidebarWidth } : undefined}
          className={cn(
            "relative shrink-0 h-full",
            isResizable && "[&>div]:w-full! [&>div>div:first-child]:w-full!",
          )}
        >
          <RepoRail />
        </div>

        {/* 시안에는 사이드바와 메인 사이에 선이 없다. 손잡이는 투명한 잡는 영역이고
            올리면 색이 드러난다. */}
        {isResizable && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t("shell.resizeSidebar")}
            onMouseDown={onMouseDown}
            style={{ width: SIDEBAR_HANDLE_WIDTH }}
            className="shrink-0 cursor-col-resize bg-transparent hover:bg-primary/40 transition-colors"
          />
        )}

        <MainColumn />
      </div>

      {/* Activity log panel (above status bar) */}
      {isActivityLogOpen && <ActivityLogPanel />}

      <StatusBar />

      {/* 저장소 메뉴에서 여는 원격 자동 최신화 설정 */}
      <AutoSyncSettingsDialogHost />
    </div>
  );
}

import { useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_SIDEBAR_WIDTH, useUIStore } from "@/stores/ui";
import { useAutoSync } from "@/hooks/useAutoSync";
import { useNotifications } from "@/hooks/useNotifications";
import { useLiveChanges } from "@/hooks/useLiveChanges"; // W1-T3
import { useSidebarWidth } from "@/hooks/useSidebarWidth";
import "@/stores/selection"; // ensure cross-store subscriptions are registered
import { RepoRail } from "./RepoRail";
import { MainColumn } from "./MainColumn";
import { SIDEBAR_HANDLE_WIDTH } from "@/lib/layout-tokens";
import { HEADER_HEIGHT_PX } from "@/lib/layout-tokens";
import { SplitHandle } from "./SplitHandle";
import { useDiffMaximizeEscape } from "./useDiffMaximize";
import { ActivityLogPanel } from "./ActivityLogPanel";
import { AutoSyncSettingsDialogHost } from "@/components/repository/AutoSyncSettingsDialog";
import { clampSidebarWidth } from "@/lib/sidebar-width";

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
  // 감시 중인 저장소의 새 커밋·CI 실패를 macOS 알림으로 알린다
  useNotifications();

  const sidebarWidth = useSidebarWidth();
  // 사이드바를 고정으로 펼친 모드에서만 폭을 사용자가 조절한다. 접힘·hover 모드는
  // 좁은 레일로 남는다(hover는 레일 위에 떠서 펼쳐진다).
  const isResizable = railMode === "expanded";

  const startWidth = useRef(sidebarWidth);
  const handleDragStart = useCallback(() => {
    startWidth.current = sidebarWidth;
  }, [sidebarWidth]);
  const handleDrag = useCallback(
    (delta: number) => setSidebarWidth(clampSidebarWidth(startWidth.current + delta, window.innerWidth)),
    [setSidebarWidth],
  );
  const handleReset = useCallback(
    () => setSidebarWidth(clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH, window.innerWidth)),
    [setSidebarWidth],
  );

  // diff 크게 보기: Escape로 되돌린다(입력 칸에 있을 때는 그 칸의 Escape가 먼저다).
  useDiffMaximizeEscape();

  return (
    // 창 바탕은 층 0(창 틀)이다. 사이드바와 폭 조절 손잡이가 같은 색으로 이어지고,
    // 본문 칸(MainColumn)만 층 1 바탕을 깐다.
    <div className="flex flex-col h-screen bg-(--frame) text-foreground overflow-hidden">
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar. When pinned open it takes the user-sized width. */}
        <RepoRail expandedWidth={isResizable ? sidebarWidth : undefined} />

        {/* 시안에는 사이드바와 메인 사이에 선이 없다. 손잡이는 다른 칸 나누기와 같은 모양이다
            (투명한 잡는 영역, 올리면 색이 드러나고, 두 번 누르면 기본 폭). */}
        {isResizable && (
          <SplitHandle
            orientation="vertical"
            size={SIDEBAR_HANDLE_WIDTH}
            headerRulePx={HEADER_HEIGHT_PX}
            aria-label={t("shell.resizeSidebar")}
            onDragStart={handleDragStart}
            onDrag={handleDrag}
            onReset={handleReset}
          />
        )}

        <MainColumn />
      </div>

      {/* 작업 기록. git 상태 줄의 작업 기록 버튼으로 연다. */}
      {isActivityLogOpen && <ActivityLogPanel />}

      {/* 저장소 메뉴에서 여는 원격 자동 최신화 설정 */}
      <AutoSyncSettingsDialogHost />
    </div>
  );
}

import { useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_SIDEBAR_WIDTH, useUIStore } from "@/stores/ui";
import { useAutoSync } from "@/hooks/useAutoSync";
import { useNotifications } from "@/hooks/useNotifications";
import { useLiveChanges } from "@/hooks/useLiveChanges"; // W1-T3
import { useSidebarWidth } from "@/hooks/useSidebarWidth";
import "@/stores/selection"; // ensure cross-store subscriptions are registered
import { RepoRail } from "./RepoRail";
import { useSidebarToggleShortcut } from "./useSidebarToggleShortcut";
import { MainColumn } from "./MainColumn";
import { SplitHandle } from "./SplitHandle";
import { useDiffMaximizeEscape } from "./useDiffMaximize";
import { ActivityLogPanel } from "./ActivityLogPanel";
import { StatusBar } from "./StatusBar";
import { RepoSettingsHost } from "@/components/settings/repo/RepoSettingsDialog";
import { clampSidebarWidth } from "@/lib/sidebar-width";

/**
 * Two-column shell from the design (`gen_d.py` `frame(side, main)`):
 * [sidebar | main column]. The main column holds the toolbar, the graph panel
 * and the file list + diff.
 */
export function MainLayout() {
  const { t } = useTranslation();
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const sidebarHidden = useUIStore((s) => s.sidebarHidden);
  const isActivityLogOpen = useUIStore((s) => s.isActivityLogOpen);

  // 저장소별 설정에 따라 원격을 주기적으로 확인하고, 안전할 때만 자동으로 받는다
  useAutoSync();
  // 여러 저장소·워크트리의 파일 변경 시각을 모은다("지금 바뀌는 곳" 등에 씀)
  useLiveChanges();
  // 감시 중인 저장소의 새 커밋·CI 실패를 macOS 알림으로 알린다
  useNotifications();

  const sidebarWidth = useSidebarWidth();
  // ⌘\로 사이드바를 숨기거나 다시 보인다.
  useSidebarToggleShortcut();

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
      <div className="relative flex flex-1 overflow-hidden">
        {/* Sidebar at the user-sized width, or out of the way when hidden. */}
        <RepoRail width={sidebarWidth} />

        {/* 시안에는 사이드바와 메인 사이에 선이 없다(사이드바의 --line 테두리가 경계다). 손잡이는
            레이아웃 폭을 차지하지 않고 그 경계 위에 겹쳐 뜬다 — 그래서 양쪽 안쪽 여백이 --g로 같게
            보인다. 평소엔 투명하고 올리면 색이 드러나며, 두 번 누르면 기본 폭으로 돌아간다. */}
        {!sidebarHidden && (
          <SplitHandle
            orientation="vertical"
            variant="overlay"
            at={sidebarWidth}
            aria-label={t("shell.resizeSidebar")}
            onDragStart={handleDragStart}
            onDrag={handleDrag}
            onReset={handleReset}
          />
        )}

        <MainColumn />
      </div>

      {/* 창 맨 아래 상태 막대: git 상태 줄(저장소) 또는 워크스페이스 요약, 오른쪽 끝은 작업 기록 버튼. */}
      <StatusBar />

      {/* 작업 기록. 상태 막대의 작업 기록 버튼으로 연다. */}
      {isActivityLogOpen && <ActivityLogPanel />}

      {/* 머리 줄 저장소 칸·저장소 메뉴에서 여는 저장소 설정 */}
      <RepoSettingsHost />
    </div>
  );
}

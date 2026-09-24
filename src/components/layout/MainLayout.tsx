import { useRef, useCallback } from "react";
import { useUIStore } from "@/stores/ui";
import { useRepositoryStore } from "@/stores/repository";
import { useAutoSync } from "@/hooks/useAutoSync";
import { useSidebarWidth } from "@/hooks/useSidebarWidth";
import "@/stores/selection"; // ensure cross-store subscriptions are registered
import { RepoRail } from "./RepoRail";
import { Sidebar } from "./Sidebar";
import { ContentArea } from "./ContentArea";
import { StatusBar } from "./StatusBar";
import { ActivityLogPanel } from "./ActivityLogPanel";
import { AutoSyncSettingsDialogHost } from "@/components/repository/AutoSyncSettingsDialog";
import { clampSidebarWidth } from "@/lib/sidebar-width";

export function MainLayout() {
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const activeTab = useUIStore((s) => s.activeTab);
  const repoListOpen = useUIStore((s) => s.repoListOpen);
  const setRepoListOpen = useUIStore((s) => s.setRepoListOpen);

  useRepositoryStore((s) => s.activeRepoPath);

  // 저장소별 설정에 따라 원격을 주기적으로 확인하고, 안전할 때만 자동으로 받는다
  useAutoSync();

  const sidebarWidth = useSidebarWidth();

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

  const isActivityLogOpen = useUIStore((s) => s.isActivityLogOpen);

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      {/* Main content row */}
      <div className="flex flex-1 overflow-hidden">
        {/* Repo quick-switch rail (Supabase-style) */}
        <RepoRail />

        {/* Left panel — Repo header + Changes/History or Repo list */}
        <div
          style={{ width: sidebarWidth }}
          className="shrink-0 overflow-hidden"
        >
          <Sidebar />
        </div>

        {/* Resize handle (acts as border between panels) */}
        <div
          onMouseDown={onMouseDown}
          className="w-px shrink-0 cursor-col-resize bg-border hover:bg-primary/40 transition-colors"
        />

        {/* Right panel — Branch header + Diff viewer */}
        <div className="relative flex-1 overflow-hidden bg-background">
          <ContentArea activeTab={activeTab} />
          {repoListOpen && (
            <div
              className="absolute inset-0 bg-black/30 z-40 transition-opacity"
              onClick={() => setRepoListOpen(false)}
            />
          )}
        </div>
      </div>

      {/* Activity log panel (above status bar) */}
      {isActivityLogOpen && <ActivityLogPanel />}

      {/* Status bar */}
      <StatusBar />

      {/* 저장소 메뉴에서 여는 원격 자동 최신화 설정 */}
      <AutoSyncSettingsDialogHost />
    </div>
  );
}

import { useState, useRef, useCallback } from "react";
import { useUIStore } from "@/stores/ui";
import { Sidebar } from "./Sidebar";
import { ContentArea } from "./ContentArea";

const MIN_SIDEBAR_WIDTH = 200;
const MIN_RIGHT_PANEL_WIDTH = 700;

export function MainLayout() {
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const activeTab = useUIStore((s) => s.activeTab);
  const repoListOpen = useUIStore((s) => s.repoListOpen);
  const setRepoListOpen = useUIStore((s) => s.setRepoListOpen);

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedFileStaged, setSelectedFileStaged] = useState(false);
  const [selectedCommitId, setSelectedCommitId] = useState<string | null>(null);

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
        const maxWidth = window.innerWidth - MIN_RIGHT_PANEL_WIDTH;
        const next = Math.min(
          maxWidth,
          Math.max(MIN_SIDEBAR_WIDTH, startWidth.current + delta),
        );
        setSidebarWidth(next);
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
    <div className="flex h-screen bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 overflow-hidden">
      {/* Left panel — Repo header + Changes/History or Repo list */}
      <div
        style={{ width: sidebarWidth }}
        className="shrink-0 overflow-hidden"
      >
        <Sidebar
          selectedFile={selectedFile}
          onSelectFile={(path, staged) => {
            setSelectedFile(path);
            setSelectedFileStaged(staged);
          }}
          selectedCommitId={selectedCommitId}
          onSelectCommit={setSelectedCommitId}
        />
      </div>

      {/* Resize handle (acts as border between panels) */}
      <div
        onMouseDown={onMouseDown}
        className="w-px shrink-0 cursor-col-resize bg-border hover:bg-primary/40 transition-colors"
      />

      {/* Right panel — Branch header + Diff viewer */}
      <div className="relative flex-1 overflow-hidden bg-white dark:bg-zinc-900">
        <ContentArea
          activeTab={activeTab}
          selectedFile={selectedFile}
          selectedFileStaged={selectedFileStaged}
          selectedCommitId={selectedCommitId}
        />
        {repoListOpen && (
          <div
            className="absolute inset-0 bg-black/30 z-40 transition-opacity"
            onClick={() => setRepoListOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

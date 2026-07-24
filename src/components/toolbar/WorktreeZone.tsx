import { useState, useRef, useEffect } from "react";
import { ChevronDown, ChevronUp, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { WorktreeIcon } from "@/components/ui/WorktreeIcon";
import { useRepositoryStore } from "@/stores/repository";
import { useUIStore } from "@/stores/ui";
import { useBranches, useWorktrees } from "@/api/queries";
import { removeWorktree, stopWorktreePreview, checkPreviewActive } from "@/api/commands";
import { useToastStore } from "@/stores/toast";
import { cn, getErrorMessage } from "@/lib/utils";
import { useClickOutside } from "./useToolbarDropdown";
import { WorktreeDropdown } from "./WorktreeDropdown";
import { CreateWorktreeDialog } from "@/components/worktree/CreateWorktreeDialog";
import { useWorktreeContext } from "@/hooks/useWorktreeContext";
import { useOpenWorktree } from "@/hooks/useOpenWorktree";
import { railFlowWidth } from "@/components/layout/RepoRail";

interface WorktreeZoneProps {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}

export function WorktreeZone({ isOpen, onToggle, onClose }: WorktreeZoneProps) {
  const zoneRef = useRef<HTMLDivElement>(null);
  useClickOutside(zoneRef, onClose, isOpen);
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const { data: branches = [] } = useBranches(activeRepoPath);
  const { data: worktrees = [] } = useWorktrees(activeRepoPath);
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const railMode = useUIStore((s) => s.railMode);
  const previewBranch = useUIStore((s) => s.previewBranch);
  const { currentWorktree, isInWorktree, mainWorktree } = useWorktreeContext(activeRepoPath, worktrees);
  const openWorktree = useOpenWorktree(activeRepoPath, worktrees);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // 마운트 시 잔여 미리보기 정리. 미리보기를 멈추면 메인 작업트리 상태가 복원되므로
  // status/branches/diff를 갱신하고, 미리보기 워크트리가 사라지므로 worktrees도 갱신한다.
  useEffect(() => {
    if (!activeRepoPath) return;
    checkPreviewActive(activeRepoPath).then((active) => {
      if (active && !previewBranch) {
        stopWorktreePreview(activeRepoPath)
          .then(() => Promise.all([
            queryClient.invalidateQueries({ queryKey: ["branches"] }),
            queryClient.invalidateQueries({ queryKey: ["repoSyncStatus"] }),
            queryClient.invalidateQueries({ queryKey: ["status"] }),
            queryClient.invalidateQueries({ queryKey: ["commitHistory"] }),
            queryClient.invalidateQueries({ queryKey: ["fileDiff"] }),
            queryClient.invalidateQueries({ queryKey: ["worktrees"] }),
          ]))
          .catch(() => {});
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRepoPath]);

  const linkedCount = worktrees.filter((w) => !w.isBare && !w.isMain).length;
  // 링크된 워크트리에 있을 때만 그 이름을 보이고, 메인/불명확할 땐 상태 라벨을 쓴다.
  // (메인 워크트리 경로의 마지막 폴더명은 저장소 이름과 같아 중복 표시가 되므로 피한다.)
  const currentLabel = isInWorktree && currentWorktree
    ? (currentWorktree.path.split("/").pop() ?? currentWorktree.path)
    : t("worktree.main");

  const handleRemoveWorktree = async (path: string) => {
    if (!activeRepoPath) return;
    try {
      await removeWorktree(activeRepoPath, path);
      await queryClient.invalidateQueries({ queryKey: ["worktrees"] });
      addToast(t("worktree.removed", { path: path.split("/").pop() }), "success");
    } catch (err) {
      addToast(t("worktree.failedToRemove", { error: getErrorMessage(err) }), "error");
    }
  };

  return (
    <div ref={zoneRef} className={cn("relative shrink-0 flex items-center", isOpen && "z-50")}>
      <button
        onClick={onToggle}
        className={cn(
          "flex items-center gap-2 px-4 w-[220px] h-[52px] border-r border-border transition-colors text-left",
          isOpen ? "relative z-50 bg-accent" : "hover:bg-accent",
        )}
      >
        <WorktreeIcon className="w-4 h-4 shrink-0 opacity-50" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground leading-tight">{t("worktree.title")}</p>
          <div className="flex items-center gap-1.5">
            <p className={cn("text-sm font-semibold truncate max-w-[160px]", isInWorktree && "text-info")}>{currentLabel}</p>
            {linkedCount > 0 && (
              <span className="text-[10px] font-semibold text-info bg-info/10 px-1.5 py-0.5 rounded-full shrink-0 tabular-nums">
                {linkedCount}
              </span>
            )}
          </div>
        </div>
        {isOpen ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {isInWorktree && mainWorktree && (
        <button
          onClick={() => openWorktree(mainWorktree.path)}
          className="flex items-center gap-1 h-[52px] px-3 border-r border-border hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          title={t("worktree.returnToMain")}
        >
          <Undo2 className="w-3.5 h-3.5" />
          <span className="text-xs font-medium">{t("worktree.returnToMainShort")}</span>
        </button>
      )}

      {isOpen && (
        <>
          {/* Backdrop — 전체 화면 (사이드바 포함) */}
          <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
          {/* Full-height panel — 사이드바 오른쪽, 툴바 아래부터 하단까지 */}
          <div
            className="fixed z-50 flex flex-col bg-popover border-r border-border shadow-2xl"
            style={{ left: railFlowWidth(railMode) + sidebarWidth + 1, top: 52, bottom: 0, width: '28rem' }}
          >
            <WorktreeDropdown
              worktrees={worktrees}
              currentPath={activeRepoPath}
              onOpenWorktree={openWorktree}
              onRemoveWorktree={handleRemoveWorktree}
              onCreateWorktree={() => setShowCreateDialog(true)}
              onClose={onClose}
            />
          </div>
        </>
      )}

      {showCreateDialog && (
        <CreateWorktreeDialog
          repoPath={activeRepoPath!}
          branches={branches}
          worktrees={worktrees}
          onClose={() => setShowCreateDialog(false)}
        />
      )}
    </div>
  );
}

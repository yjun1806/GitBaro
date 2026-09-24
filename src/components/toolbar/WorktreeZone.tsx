import { useState, useRef, useEffect } from "react";
import { ChevronDown, ChevronUp, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { WorktreeIcon } from "@/components/ui/WorktreeIcon";
import { useOwnerRepoPath, useRepositoryStore } from "@/stores/repository";
import { useUIStore } from "@/stores/ui";
import { useBranches, useWorktrees } from "@/api/queries";
import {
  removeWorktree,
  stopWorktreePreview,
  checkPreviewActive,
  openInTerminal,
  openRepoInEditor,
} from "@/api/commands";
import { useToastStore } from "@/stores/toast";
import { cn, getErrorMessage } from "@/lib/utils";
import { TOOLBAR_LABEL_CLASS } from "./ActionButton";
import { useClickOutside } from "./useToolbarDropdown";
import { WorktreePanel } from "@/components/worktree/WorktreePanel";
import { CreateWorktreeDialog } from "@/components/worktree/CreateWorktreeDialog";
import { useWorktreeContext } from "@/hooks/useWorktreeContext";
import { useOpenWorktree } from "@/hooks/useOpenWorktree";

interface WorktreeZoneProps {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}

export function WorktreeZone({ isOpen, onToggle, onClose }: WorktreeZoneProps) {
  const zoneRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useClickOutside(zoneRef, onClose, isOpen);
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const ownerRepoPath = useOwnerRepoPath();
  const { data: branches = [] } = useBranches(activeRepoPath);
  const { data: worktrees = [] } = useWorktrees(ownerRepoPath);
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const previewBranch = useUIStore((s) => s.previewBranch);
  const { currentWorktree, isInWorktree, mainWorktree } = useWorktreeContext(activeRepoPath, worktrees);
  const openWorktree = useOpenWorktree(activeRepoPath, worktrees);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // 마운트 시 잔여 미리보기 정리. checkPreviewActive는 GitBaro가 미리보기를 시작하며
  // 남긴 표식 파일만 본다(사용자가 진행 중인 merge는 미리보기로 보지 않는다).
  // 미리보기를 멈추면 메인 작업트리 상태가 복원되므로
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

  const repoName = activeRepoPath?.split("/").filter(Boolean).pop() ?? "";

  return (
    <div
      ref={zoneRef}
      // 툴바가 좁으면 이 칸이 먼저 줄어든다. 오른쪽 git 작업·계정·설정이 잘리지 않게 한다.
      className={cn("relative min-w-[44px] shrink flex items-center", isOpen && "z-50")}
    >
      {/* 워크트리 칩 — 시안 D5 wt_strip 칩과 같은 자리(gen_d2.py:172-176). 브랜치 칸(BranchZone) 바로
          옆에 붙어 하나의 「지금 맥락」 제목 블록으로 읽힌다. */}
      <button
        ref={triggerRef}
        onClick={onToggle}
        className={cn(
          "flex items-center gap-1.5 h-[30px] px-2.5 rounded-(--radius-item) border border-(--line2) bg-card shadow-(--shadow-sm) min-w-0 overflow-hidden transition-colors text-left",
          isOpen && "relative z-50 bg-accent",
        )}
      >
        <WorktreeIcon className={cn("w-3.5 h-3.5 shrink-0", isInWorktree ? "text-info" : "text-(--faint)")} />
        <span className={cn("text-xs font-mono font-semibold truncate max-w-[140px]", isInWorktree && "text-info")}>
          {currentLabel}
        </span>
        {linkedCount > 0 && (
          <span className="text-[10px] font-semibold text-info bg-info/10 px-1.5 py-0.5 rounded-full shrink-0 tabular-nums">
            {linkedCount}
          </span>
        )}
        {isOpen ? (
          <ChevronUp className="w-3 h-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
        )}
      </button>

      {isInWorktree && mainWorktree && (
        <button
          onClick={() => openWorktree(mainWorktree.path)}
          className="flex items-center gap-1 h-[30px] px-2 ml-1.5 rounded-(--radius-item) shrink-0 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          title={t("worktree.returnToMain")}
          aria-label={t("worktree.returnToMain")}
        >
          <Undo2 className="w-3.5 h-3.5" />
          <span className={cn("text-xs font-medium", TOOLBAR_LABEL_CLASS)}>{t("worktree.returnToMainShort")}</span>
        </button>
      )}

      {isOpen && (
        <WorktreePanel
          anchorRef={triggerRef}
          repoName={repoName}
          worktrees={worktrees}
          currentPath={activeRepoPath}
          onOpenWorktree={openWorktree}
          onOpenTerminal={(path) =>
            openInTerminal(path).catch((err) =>
              addToast(t("gitActions.terminalFailed", { error: getErrorMessage(err) }), "error"),
            )
          }
          onOpenEditor={(path) =>
            openRepoInEditor(path).catch((err) =>
              addToast(t("error.failedToOpenEditor", { error: getErrorMessage(err) }), "error"),
            )
          }
          onRemoveWorktree={handleRemoveWorktree}
          onCreateWorktree={() => setShowCreateDialog(true)}
          onClose={onClose}
        />
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

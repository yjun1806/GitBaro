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
import { TOOLBAR_ICON, toolbarButtonClass } from "./toolbar-button";
import { useClickOutside } from "./useToolbarDropdown";
import { WorktreePanel } from "@/components/worktree/WorktreePanel";
import { CreateWorktreeDialog } from "@/components/worktree/CreateWorktreeDialog";
import { useWorktreeContext } from "@/hooks/useWorktreeContext";
import { useOpenWorktree } from "@/hooks/useOpenWorktree";
import { useCurrentPlaceMenu } from "./useCurrentPlaceMenu";

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
  const placeMenu = useCurrentPlaceMenu(currentWorktree?.branch ?? null);

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
        onContextMenu={placeMenu.onContextMenu}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        // 「기본 폴더」는 브랜치 main과 헷갈리기 쉬워 뜻을 툴팁으로 덧붙인다.
        title={isInWorktree ? undefined : t("worktree.primaryFolderHint")}
        className={cn(toolbarButtonClass({ open: isOpen }), "min-w-0 shrink overflow-hidden", isOpen && "relative z-50")}
      >
        <WorktreeIcon className={TOOLBAR_ICON} />
        <span className={cn("font-mono truncate max-w-[140px]", isInWorktree && "text-foreground font-semibold")}>
          {currentLabel}
        </span>
        {linkedCount > 0 && (
          <span className="h-4 min-w-4 px-1 rounded-full bg-foreground/[0.08] text-[10.5px] font-semibold flex items-center justify-center shrink-0 tabular-nums">
            {linkedCount}
          </span>
        )}
        {isOpen ? (
          <ChevronUp className="w-3 h-3 opacity-60 shrink-0" />
        ) : (
          <ChevronDown className="w-3 h-3 opacity-60 shrink-0" />
        )}
      </button>

      {isInWorktree && mainWorktree && (
        <button
          onClick={() => openWorktree(mainWorktree.path)}
          className={cn(toolbarButtonClass(), "ml-0.5")}
          title={`${t("worktree.returnToMain")}\n${t("worktree.primaryFolderHint")}`}
          aria-label={t("worktree.returnToMain")}
        >
          <Undo2 className={TOOLBAR_ICON} />
          <span className={TOOLBAR_LABEL_CLASS}>{t("worktree.returnToMainShort")}</span>
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

      {placeMenu.element}

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

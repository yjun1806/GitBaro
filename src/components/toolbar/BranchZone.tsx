import { useState, useRef } from "react";
import { GitBranch, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { avatarColor, avatarInitial } from "@/lib/avatar-color";
import { useOwnerRepoPath, useRepositoryStore } from "@/stores/repository";
import { useUIStore } from "@/stores/ui";
import { useBranches, useHeadDetached, useStatus, useWorktrees } from "@/api/queries";
import {
  switchBranch,
  createBranch,
  deleteBranch,
  renameBranch,
  stashPush,
  stashPopByOid,
} from "@/api/commands";
import { useQueryClient } from "@tanstack/react-query";
import { useToastStore } from "@/stores/toast";
import { useSelectionStore } from "@/stores/selection";
import { cn, getErrorMessage } from "@/lib/utils";
import { useClickOutside, useToolbarDropdownContext } from "./useToolbarDropdown";
import { ActionButton } from "./ActionButton";
import { toolbarButtonClass } from "./toolbar-button";
import { Tooltip } from "@/components/ui/Tooltip";
import { HEADER_HEIGHT_PX } from "@/lib/layout-tokens";
import { BranchPanel } from "@/components/branch/BranchPanel";
import { BranchMergeDialog } from "@/components/branch/BranchMergeDialog";
import { useBranchRangeStore } from "@/components/branch/branch-range";
import { CreateBranchDialog } from "@/components/branch/CreateBranchDialog";
import { DeleteBranchDialog } from "@/components/branch/DeleteBranchDialog";
import { RenameBranchDialog } from "@/components/branch/RenameBranchDialog";
import { WorktreeBaseLabel } from "@/components/worktree/WorktreeBaseLabel";
import { selectionAfterStashPushed } from "@/lib/stash-selection";
import { runWithStashedChanges } from "./run-with-stashed-changes";
import { useWorktreeContext } from "@/hooks/useWorktreeContext";
import { useOpenWorktree } from "@/hooks/useOpenWorktree";
import { useCheckoutBranch } from "@/components/branch/useCheckoutBranch";
import { useCurrentPlaceMenu } from "./useCurrentPlaceMenu";

/**
 * 툴바 오른쪽 [브랜치 · Merge · Stash] 묶음의 「브랜치」 버튼. 왼쪽 브랜치 칸과 같은
 * 브랜치 패널(시안 D6, `BranchPanel`)을 연다.
 */
export function BranchPanelButton() {
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const onOpenBranchPanel = useOpenBranchPanel();
  return (
    <ActionButton
      action="branch"
      icon={GitBranch}
      label={t("gitActions.branch")}
      disabled={!activeRepoPath}
      caret
      onClick={onOpenBranchPanel}
    />
  );
}

/** 브랜치 패널을 연다. 패널은 `BranchZone`이 그린다. */
function useOpenBranchPanel(): () => void {
  const { toggle } = useToolbarDropdownContext();
  return () => toggle("branch");
}

/** 제목 툴팁을 머리 줄 아래 경계보다 6px 아래에 띄운다(28px 버튼은 줄 안에서 가운데 정렬). */
const TITLE_TOOLTIP_OFFSET_PX = (HEADER_HEIGHT_PX - 28) / 2 + 6;

interface BranchZoneProps {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}

export function BranchZone({ isOpen, onToggle, onClose }: BranchZoneProps) {
  const zoneRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useClickOutside(zoneRef, onClose, isOpen);
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const ownerRepoPath = useOwnerRepoPath();
  const { data: branches = [] } = useBranches(activeRepoPath);
  const { data: isDetached = false } = useHeadDetached(activeRepoPath);
  const { data: statusFiles = [] } = useStatus(activeRepoPath);
  const { data: worktrees = [] } = useWorktrees(ownerRepoPath);
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const activeRepoName = useRepositoryStore((s) => s.activeRepo?.name ?? "");
  const { mainWorktree, currentWorktree, isInWorktree } = useWorktreeContext(activeRepoPath, worktrees);
  const openWorktree = useOpenWorktree(activeRepoPath, worktrees);
  // 전환은 「보는 중」 띠·그래프 메뉴와 같은 규칙(원격→로컬 이름, 다른 워크트리면 이동, 변경은 묻기)을 쓴다.
  const { checkout, element: checkoutDialog } = useCheckoutBranch();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [pendingRename, setPendingRename] = useState<string | null>(null);
  const [pendingMerge, setPendingMerge] = useState<string | null>(null);

  const headBranch = branches.find((b) => b.isHead);
  const currentBranch = headBranch?.name ?? null;
  const isSwitchingBranch = useUIStore((s) => s.isSwitchingBranch);
  const ahead = headBranch?.aheadBehind?.ahead ?? 0;
  const behind = headBranch?.aheadBehind?.behind ?? 0;
  const isDirty = statusFiles.length > 0;

  // Branch switches touch the working tree, the stash list and the reflog, so
  // everything derived from them is refetched — after failures too.
  const invalidateAll = () =>
    Promise.all(
      [
        "branches",
        "repoSyncStatus",
        "status",
        "commitHistory",
        "fileDiff",
        "stashList",
        "stashShow",
        "recentBranches",
        "worktrees",
        // 브랜치를 만들거나 바꾸면 「파일별 변경」(D7)의 기준(브랜치)과 목록도 바뀐다(W7 리뷰).
        "changesVsDefault",
        "fileDiffVsDefault",
        // 사이드바의 「보기만 하는 기본 브랜치」 줄은 기본 브랜치를 체크아웃한 폴더가 있는지에 따라 바뀐다.
        "defaultBranches",
      ].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
    );

  // 브랜치가 바뀌면 이전 브랜치 기준의 파일·커밋 선택은 무효이므로 초기화한다.
  const clearBranchScopedSelection = () => {
    const { clearFileSelection, clearCommitSelection } = useSelectionStore.getState();
    clearFileSelection();
    clearCommitSelection();
  };

  /**
   * Runs `action` with the changes (untracked files included) stashed and
   * pops that same stash afterwards — on success only when `popOnSuccess`.
   * Reports failures as toasts and returns true when the action succeeded.
   */
  const runStashed = async (
    repoPath: string,
    action: () => Promise<void>,
    options: { popOnSuccess: boolean; failureKey: "branch.failedToSwitch" | "branch.failedToCreate" },
  ): Promise<boolean> => {
    const outcome = await runWithStashedChanges({
      stash: () => stashPush(repoPath),
      restore: (oid) => stashPopByOid(repoPath, oid),
      action,
      popOnSuccess: options.popOnSuccess,
    });
    const leftInStash = outcome.status === "restoreFailed" || ("leftInStash" in outcome && outcome.leftInStash);
    if (leftInStash) {
      // The new entry is stash@{0}; keep the stash tab on the entry it showed.
      const { selectedStashIndex, selectStash } = useSelectionStore.getState();
      selectStash(selectionAfterStashPushed(selectedStashIndex));
    }
    switch (outcome.status) {
      case "done":
        return true;
      case "stashFailed":
        addToast(t("branch.failedToStash", { error: getErrorMessage(outcome.error) }), "error");
        return false;
      case "actionFailed": {
        const message = t(options.failureKey, { error: getErrorMessage(outcome.error) });
        addToast(
          outcome.leftInStash ? `${message} ${t("branch.changesKeptInStash")}` : message,
          "error",
        );
        return false;
      }
      case "restoreFailed":
        addToast(
          t("branch.changesRestoreFailed", { error: getErrorMessage(outcome.error) }),
          "warning",
        );
        return true;
    }
  };

  const handleCreate = async (name: string, fromBranch: string) => {
    if (!activeRepoPath) return;
    const repoPath = activeRepoPath;
    const { setSwitchingBranch } = useUIStore.getState();
    setSwitchingBranch(true);
    try {
      const createAndSwitch = async () => {
        await createBranch(repoPath, name, fromBranch);
        await switchBranch(repoPath, name);
      };
      // A clean tree needs no stash round-trip.
      let created: boolean;
      if (isDirty) {
        created = await runStashed(repoPath, createAndSwitch, {
          popOnSuccess: true,
          failureKey: "branch.failedToCreate",
        });
      } else {
        try {
          await createAndSwitch();
          created = true;
        } catch (err) {
          addToast(t("branch.failedToCreate", { error: getErrorMessage(err) }), "error");
          created = false;
        }
      }
      if (created) {
        clearBranchScopedSelection();
        addToast(t("branch.createdAndSwitched", { name }), "success");
        setShowCreateDialog(false);
      }
    } finally {
      await invalidateAll();
      setSwitchingBranch(false);
    }
  };

  const handleDelete = (branchName: string) => {
    setPendingDelete(branchName);
  };

  const handleDeleteConfirm = async () => {
    if (!activeRepoPath || !pendingDelete) return;
    const name = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteBranch(activeRepoPath, name);
      await invalidateAll();
      addToast(t("branch.deleted", { name }), "success");
    } catch (err) {
      addToast(t("branch.failedToDelete", { error: getErrorMessage(err) }), "error");
    }
  };

  const handleRenameConfirm = async (oldName: string, newName: string) => {
    if (!activeRepoPath) return;
    try {
      await renameBranch(activeRepoPath, oldName, newName);
      addToast(t("branch.renamed", { old: oldName, new: newName }), "success");
      setPendingRename(null);
    } catch (err) {
      addToast(t("branch.failedToRename", { error: getErrorMessage(err) }), "error");
    } finally {
      await invalidateAll();
    }
  };

  const handleCompare = (branchName: string) => {
    // 그래프를 「지금 브랜치..고른 브랜치」 범위 모드로 바꾼다(그래프 탭으로 전환).
    if (!activeRepoPath || !currentBranch) return;
    useBranchRangeStore.getState().setRange({
      repoPath: activeRepoPath,
      base: currentBranch,
      target: branchName,
      head: currentBranch,
    });
    useUIStore.getState().setActiveTab("history");
    onClose();
  };

  const handleMerge = (branchName: string) => {
    setPendingMerge(branchName);
    onClose();
  };

  const handleCopyName = (branchName: string) => {
    navigator.clipboard.writeText(branchName);
    addToast(t("branch.copiedName"), "success");
  };

  const placeMenu = useCurrentPlaceMenu(currentBranch);
  const repoTitle = mainWorktree?.path.split("/").filter(Boolean).pop() ?? activeRepoName;
  const avatar = avatarColor(activeRepoPath ?? repoTitle);
  const originAhead = !isInWorktree ? ahead : 0;
  const branchText = currentBranch ?? (isDetached ? t("branch.detachedHead") : t("branch.noBranch"));
  const titleTooltip = [
    `${repoTitle} · ${branchText}`,
    originAhead > 0 ? t("branch.originAhead", { count: originAhead }) : null,
    behind > 0 ? t("sidebarTree.badge.behind", { count: behind }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      ref={zoneRef}
      // 툴바가 좁으면 이 칸이 먼저 줄어든다(브랜치 이름은 말줄임). 오른쪽 git 작업·계정·설정이 잘리지 않게 한다.
      className={cn("relative min-w-[60px] shrink flex items-center", isOpen && "z-50")}
    >
      {/* 제목 버튼: 다른 툴바 버튼과 같은 28px 모양의 한 줄(아바타 · 저장소 · 브랜치 · 기반/앞뒤 수 · ▾).
          전체 글은 머리 줄 아래로 늦게 뜨는 툴팁으로 보인다(버튼 바로 밑에서 줄 경계와 겹치지 않게). */}
      <Tooltip label={titleTooltip} side="bottom" offset={TITLE_TOOLTIP_OFFSET_PX} delayMs={600} className="min-w-0">
        <button
          ref={triggerRef}
          onClick={onToggle}
          onContextMenu={placeMenu.onContextMenu}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          className={cn(
            toolbarButtonClass({ open: isOpen }),
            "min-w-0 shrink overflow-hidden text-left pl-1",
            isOpen && "relative z-50",
          )}
        >
          <span
            aria-hidden="true"
            className="w-5 h-5 rounded-[5px] shrink-0 flex items-center justify-center text-[10.5px] font-extrabold"
            style={{ backgroundColor: avatar.background, color: avatar.foreground }}
          >
            {avatarInitial(repoTitle)}
          </span>
          <span className="text-[13px] font-bold text-(--fg) truncate max-w-[160px]">{repoTitle}</span>
          <span className="flex items-center gap-1 font-mono text-xs text-(--fg2) min-w-0 shrink">
            {isSwitchingBranch ? (
              <Loader2 className="w-3 h-3 shrink-0 animate-spin" />
            ) : (
              <GitBranch className="w-3 h-3 shrink-0 opacity-60" />
            )}
            <span className="truncate">{branchText}</span>
          </span>
          {isInWorktree && currentWorktree?.base ? (
            <WorktreeBaseLabel base={currentWorktree.base} variant="compact" className="shrink-0 text-[11px]" />
          ) : null}
          {(originAhead > 0 || behind > 0) && (
            <span className="shrink-0 text-[11px] text-(--muted) tabular-nums">
              {[originAhead > 0 ? `↑${originAhead}` : null, behind > 0 ? `↓${behind}` : null].filter(Boolean).join(" ")}
            </span>
          )}
          {isOpen ? (
            <ChevronUp className="w-3 h-3 opacity-60 shrink-0" />
          ) : (
            <ChevronDown className="w-3 h-3 opacity-60 shrink-0" />
          )}
        </button>
      </Tooltip>

      {isOpen && (
        <BranchPanel
          anchorRef={triggerRef}
          repoName={repoTitle}
          activeRepoPath={activeRepoPath}
          branches={branches}
          worktrees={worktrees}
          currentBranch={currentBranch}
          onSwitch={checkout}
          onOpenWorktree={openWorktree}
          onCompare={handleCompare}
          onMerge={handleMerge}
          onRename={setPendingRename}
          onDelete={handleDelete}
          onCopyName={handleCopyName}
          onCreateBranch={() => setShowCreateDialog(true)}
          onClose={onClose}
        />
      )}

      {placeMenu.element}

      {showCreateDialog && (
        <CreateBranchDialog
          branches={branches}
          currentBranch={currentBranch}
          onCreate={handleCreate}
          onClose={() => setShowCreateDialog(false)}
        />
      )}

      {checkoutDialog}

      {pendingRename && (
        <RenameBranchDialog
          branchName={pendingRename}
          branches={branches}
          onRename={(newName) => handleRenameConfirm(pendingRename, newName)}
          onClose={() => setPendingRename(null)}
        />
      )}

      {pendingMerge && activeRepoPath && currentBranch && (
        <BranchMergeDialog
          repoPath={activeRepoPath}
          currentBranch={currentBranch}
          source={pendingMerge}
          isDirty={isDirty}
          onClose={() => setPendingMerge(null)}
        />
      )}

      {pendingDelete && (
        <DeleteBranchDialog
          branchName={pendingDelete}
          isFullyMerged={branches.find((b) => b.name === pendingDelete)?.isFullyMerged ?? false}
          onConfirm={handleDeleteConfirm}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

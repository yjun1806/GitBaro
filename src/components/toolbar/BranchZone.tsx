import { useState, useRef } from "react";
import { GitBranch, ChevronDown, ChevronUp, Eye, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
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
import { middleEllipsis } from "@/lib/middle-ellipsis";
import { useClickOutside } from "./useToolbarDropdown";
import { TOOLBAR_ICON, toolbarButtonClass } from "./toolbar-button";
import { TOOLBAR_LABEL_CLASS } from "./ActionButton";
import { Tooltip } from "@/components/ui/Tooltip";
import { HEADER_HEIGHT_PX } from "@/lib/layout-tokens";
import { BranchPanel } from "@/components/branch/BranchPanel";
import { BranchMergeDialog } from "@/components/branch/BranchMergeDialog";
import { useBranchRangeStore } from "@/components/branch/branch-range";
import { CreateBranchDialog } from "@/components/branch/CreateBranchDialog";
import { DeleteBranchDialog } from "@/components/branch/DeleteBranchDialog";
import { RenameBranchDialog } from "@/components/branch/RenameBranchDialog";
import { WorktreeBaseLabel } from "@/components/worktree/WorktreeBaseLabel";
import { worktreeBaseSummary } from "@/lib/worktree-base";
import { selectionAfterStashPushed } from "@/lib/stash-selection";
import { runWithStashedChanges } from "./run-with-stashed-changes";
import { useWorktreeContext } from "@/hooks/useWorktreeContext";
import { useOpenWorktree } from "@/hooks/useOpenWorktree";
import { useCheckoutBranch } from "@/components/branch/useCheckoutBranch";
import { useCurrentPlaceMenu } from "./useCurrentPlaceMenu";
import { useMenuActions } from "@/hooks/useMenuActions";
import { useActiveRepoName } from "@/hooks/useRepoDisplay";
import { Spinner } from "@/components/ui/Spinner";
import { useHistoryView, useSetHistoryView } from "@/components/graph/useHistoryView";
import { viewTargetLabel } from "@/components/review/git-status-line";

/** 제목 툴팁을 머리 줄 아래 경계보다 6px 아래에 띄운다(28px 버튼은 줄 안에서 가운데 정렬). */
const TITLE_TOOLTIP_OFFSET_PX = (HEADER_HEIGHT_PX - 28) / 2 + 6;

/** 브랜치 이름이 이보다 길면 가운데를 생략한다(끝을 자르는 CSS truncate와 달리 끝도 보인다). 전체 이름은 title에 남는다. */
const BRANCH_NAME_MAX_CHARS = 28;

/**
 * 「<base> 기반」 라벨을 보일 최소 너비. 겹침 폭 우선순위의 첫 항목(가장 먼저 감춘다) — 감춰도 뜻은
 * 브랜치 버튼의 툴팁(`titleTooltip`)에 남는다.
 */
const BASE_LABEL_VISIBLE_CLASS = "hidden shrink-0 @min-[1360px]:inline-flex";
/** 보일 때도 너무 긴 기반 브랜치 이름은 줄인다(전체 이름은 라벨 자체의 title에 남는다). */
const BASE_LABEL_MAX_CHARS = 20;

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
  // 복사는 결과를 기다려 성공·실패를 알린다(다른 메뉴와 같은 동작).
  const actions = useMenuActions();
  const repoTitle = useActiveRepoName();
  const { currentWorktree, isInWorktree } = useWorktreeContext(activeRepoPath, worktrees);
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
        // 브랜치를 만들거나 바꾸면 main과 갈라진 지점도 바뀐다.
        "divergencePoint",
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


  const placeMenu = useCurrentPlaceMenu(currentBranch);
  const originAhead = !isInWorktree ? ahead : 0;
  const branchText = currentBranch ?? (isDetached ? t("branch.detachedHead") : t("branch.noBranch"));
  // 체크아웃하지 않고 다른 브랜치(또는 모든 브랜치)의 이력을 보는 중이면, 이 칸은 체크아웃 대신
  // 그 대상을 보인다(예전 그래프 머리의 「보는 브랜치」 고르기, 이제 경로의 이 칸으로 옮김).
  const { target: viewTarget } = useHistoryView();
  const setHistoryView = useSetHistoryView();
  const viewingLabel = viewTarget ? viewTargetLabel(viewTarget, t) : null;
  const viewing = viewingLabel !== null;
  const crumbText = viewingLabel ?? branchText;
  // 기반 브랜치 라벨은 지금 체크아웃한 브랜치의 것이라, 보는 중에는 다른 브랜치와 섞여 헷갈리므로 감춘다.
  const worktreeBase = !viewing && isInWorktree ? (currentWorktree?.base ?? null) : null;
  // 폭이 좁아 라벨(BASE_LABEL_VISIBLE_CLASS)이 숨어도 뜻은 여기 남는다.
  const baseText = worktreeBase ? worktreeBaseSummary(worktreeBase, t) : null;
  const titleTooltip = viewing
    ? `${repoTitle} · ${viewingLabel} · ${t("historyView.pickerHint")}`
    : [
        `${repoTitle} · ${branchText}`,
        baseText,
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
      {/* 경로의 마지막 칸: 브랜치 · 기반 · ▾. 저장소 이름은 앞 칸(RepoCrumb)이, 올릴 커밋 수는 Push 버튼이 맡는다.
          전체 글은 머리 줄 아래로 늦게 뜨는 툴팁으로 보인다(버튼 바로 밑에서 줄 경계와 겹치지 않게).
          폭 우선순위: 좁아지면 기반 라벨부터 감추고(툴팁에 남음), 그다음 브랜치 이름을 가운데 생략한다. */}
      <Tooltip label={titleTooltip} side="bottom" offset={TITLE_TOOLTIP_OFFSET_PX} delayMs={600} className="min-w-0">
        <button
          ref={triggerRef}
          onClick={onToggle}
          onContextMenu={placeMenu.onContextMenu}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          data-testid="branch-crumb"
          aria-label={
            viewing
              ? t("toolbar.branchStep.viewingCrumb", { target: viewingLabel })
              : t("toolbar.branchCrumb", { branch: branchText })
          }
          className={cn(
            toolbarButtonClass({ open: isOpen }),
            "min-w-0 shrink overflow-hidden text-left",
            isOpen && "relative z-50",
          )}
        >
          <span className="flex items-center gap-1 font-mono text-[11.5px] text-(--fg) min-w-0 shrink">
            {viewing ? (
              <Eye className="w-3.5 h-3.5 shrink-0 text-info" aria-hidden="true" />
            ) : isSwitchingBranch ? (
              <Spinner />
            ) : (
              <GitBranch className="w-3.5 h-3.5 shrink-0 text-(--fg2)" />
            )}
            <span className="truncate min-w-0">{middleEllipsis(crumbText, BRANCH_NAME_MAX_CHARS)}</span>
          </span>
          {worktreeBase && (
            <span className={BASE_LABEL_VISIBLE_CLASS} data-testid="worktree-base-chip">
              <WorktreeBaseLabel
                base={worktreeBase}
                variant="compact"
                maxBaseNameLength={BASE_LABEL_MAX_CHARS}
                className="shrink-0 text-[11.5px]"
              />
            </span>
          )}
          {isOpen ? (
            <ChevronUp className="w-3 h-3 opacity-60 shrink-0" />
          ) : (
            <ChevronDown className="w-3 h-3 opacity-60 shrink-0" />
          )}
        </button>
      </Tooltip>

      {/* 보는 중일 때만 보이는 빠른 되돌리기 — 패널을 열지 않고 바로 체크아웃한 브랜치로 돌아간다
          (WorktreeZone의 「돌아가기」와 같은 자리·모양). 패널 안 「현재 체크아웃」 행으로도 갈 수 있다. */}
      {viewing && (
        <button
          type="button"
          onClick={() => setHistoryView(null)}
          className={cn(toolbarButtonClass(), "ml-0.5")}
          title={t("toolbar.branchStep.backToRepo")}
          aria-label={t("toolbar.branchStep.backToRepo")}
        >
          <Undo2 className={TOOLBAR_ICON} />
          <span className={TOOLBAR_LABEL_CLASS}>{t("toolbar.branchStep.backToRepoShort")}</span>
        </button>
      )}

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
          onCopyName={actions.copy}
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

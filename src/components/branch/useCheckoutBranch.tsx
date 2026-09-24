import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useOwnerRepoPath, useRepositoryStore } from "@/stores/repository";
import { useUIStore } from "@/stores/ui";
import { useToastStore } from "@/stores/toast";
import { useSelectionStore } from "@/stores/selection";
import { useHistoryViewStore } from "@/stores/history-view";
import { useBranches, useStatus, useWorktrees } from "@/api/queries";
import { stashPopByOid, stashPush, switchBranch } from "@/api/commands";
import { useOpenWorktree } from "@/hooks/useOpenWorktree";
import { getErrorMessage } from "@/lib/utils";
import { selectionAfterStashPushed } from "@/lib/stash-selection";
import { runWithStashedChanges } from "@/components/toolbar/run-with-stashed-changes";
import type { WorktreeInfo } from "@/types";
import { SwitchBranchDialog } from "./SwitchBranchDialog";

/** 체크아웃 뒤 다시 읽을 쿼리. 작업 트리·스태시·이력이 모두 바뀐다. */
const CHECKOUT_QUERY_KEYS = [
  "branches",
  "repoSyncStatus",
  "status",
  "commitHistory",
  "fileDiff",
  "stashList",
  "stashShow",
  "recentBranches",
  "worktrees",
  "changesVsDefault",
  "fileDiffVsDefault",
];

function trimSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/**
 * `branchName`(로컬 이름, 또는 로컬이 없는 원격 이름)을 체크아웃한 다른 워크트리.
 * git은 그 브랜치를 두 곳에서 체크아웃하지 못하므로 그 워크트리로 이동해야 한다.
 */
export function worktreeHolding(
  branchName: string,
  worktrees: readonly WorktreeInfo[],
  activePath: string | null,
): WorktreeInfo | null {
  const active = activePath ? trimSlash(activePath) : null;
  return (
    worktrees.find((w) => w.branch === branchName && !w.isBare && trimSlash(w.path) !== active) ?? null
  );
}

/**
 * 「보는 중」 띠의 [이 브랜치로 체크아웃]. 툴바 브랜치 패널과 같은 규칙으로 체크아웃한다.
 * - 다른 워크트리가 쓰는 브랜치: 체크아웃 대신 그 워크트리로 이동한다.
 * - 커밋 안 한 변경이 있으면: 스태시에 두고 갈지, 가져갈지 묻는다(`SwitchBranchDialog`).
 * - 원격에만 있는 브랜치: 백엔드가 그 원격을 추적하는 로컬 브랜치를 만든다(`switch_branch`).
 * 체크아웃에 성공하면 보기를 끝내고 현재 체크아웃을 보여 준다.
 */
export function useCheckoutBranch(): { checkout: (branchName: string) => void; element: ReactNode } {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const ownerRepoPath = useOwnerRepoPath();
  const { data: branches = [] } = useBranches(activeRepoPath);
  const { data: statusFiles = [] } = useStatus(activeRepoPath);
  const { data: worktrees = [] } = useWorktrees(ownerRepoPath);
  const openWorktree = useOpenWorktree(activeRepoPath, worktrees);
  const [pending, setPending] = useState<string | null>(null);
  const currentBranch = branches.find((b) => b.isHead && !b.isRemote)?.name ?? null;

  const switchTo = async (repoPath: string, branchName: string, mode: "leave" | "bring") => {
    const { addToast } = useToastStore.getState();
    const { setSwitchingBranch } = useUIStore.getState();
    setSwitchingBranch(true);
    try {
      let switched = false;
      if (mode === "leave") {
        const outcome = await runWithStashedChanges({
          stash: () => stashPush(repoPath),
          restore: (oid) => stashPopByOid(repoPath, oid),
          action: () => switchBranch(repoPath, branchName),
          popOnSuccess: false,
        });
        const leftInStash =
          outcome.status === "restoreFailed" || ("leftInStash" in outcome && outcome.leftInStash);
        if (leftInStash) {
          const { selectedStashIndex, selectStash } = useSelectionStore.getState();
          selectStash(selectionAfterStashPushed(selectedStashIndex));
        }
        if (outcome.status === "stashFailed") {
          addToast(t("branch.failedToStash", { error: getErrorMessage(outcome.error) }), "error");
        } else if (outcome.status === "actionFailed") {
          const message = t("branch.failedToSwitch", { error: getErrorMessage(outcome.error) });
          addToast(outcome.leftInStash ? `${message} ${t("branch.changesKeptInStash")}` : message, "error");
        } else {
          switched = true;
        }
      } else {
        try {
          await switchBranch(repoPath, branchName);
          switched = true;
        } catch (err) {
          addToast(t("branch.failedToSwitch", { error: getErrorMessage(err) }), "error");
        }
      }
      if (switched) {
        useHistoryViewStore.getState().reset();
        const { clearFileSelection, clearCommitSelection } = useSelectionStore.getState();
        clearFileSelection();
        clearCommitSelection();
        addToast(t("branch.switchedTo", { name: branchName }), "success");
      }
    } finally {
      await Promise.all(CHECKOUT_QUERY_KEYS.map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
      setSwitchingBranch(false);
    }
  };

  const checkout = (branchName: string) => {
    if (!activeRepoPath || branchName === currentBranch) return;
    const holder = worktreeHolding(branchName, worktrees, activeRepoPath);
    if (holder) {
      void openWorktree(holder.path);
      return;
    }
    if (statusFiles.length > 0) {
      setPending(branchName);
      return;
    }
    void switchTo(activeRepoPath, branchName, "bring");
  };

  const element = pending ? (
    <SwitchBranchDialog
      currentBranch={currentBranch ?? t("branch.detachedHead")}
      targetBranch={pending}
      onConfirm={(mode) => {
        const target = pending;
        setPending(null);
        if (activeRepoPath) void switchTo(activeRepoPath, target, mode);
      }}
      onClose={() => setPending(null)}
    />
  ) : null;

  return { checkout, element };
}

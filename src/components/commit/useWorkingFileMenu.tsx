import { useCallback, useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { addToGitignore, discardChanges, findConflictMarkers, stageFiles, unstageFiles } from "@/api/commands";
import { Dialog } from "@/components/ui/Dialog";
import { entryPaths } from "@/lib/file-selection";
import { getErrorMessage } from "@/lib/utils";
import { useToastStore } from "@/stores/toast";
import type { StatusEntry } from "@/types";
import { FileContextMenu } from "./FileContextMenu";

/** Confirmation text for discarding `entry`, matching what the backend will do. */
function discardMessageKey(entry: StatusEntry): string {
  if (!entry.staged) {
    // "added" on the unstaged side is an intent-to-add (`git add -N`) file,
    // which the backend moves to the Trash like an untracked one.
    return entry.status === "untracked" || entry.status === "added"
      ? "changes.discardUntrackedMessage"
      : "changes.discardUnstagedMessage";
  }
  return entry.status === "added" || entry.status === "copied"
    ? "changes.discardAddedMessage"
    : "changes.discardStagedMessage";
}

export interface WorkingFileMenu {
  /** 스테이지·언스테이지. 충돌 마커가 남은 파일은 먼저 확인한다. */
  toggleStage: (entry: StatusEntry) => Promise<void>;
  /** 되돌리기 확인 창을 연다. */
  askDiscard: (entry: StatusEntry) => void;
  /** 이 행의 우클릭 메뉴를 연다. */
  openMenu: (entry: StatusEntry, position: { x: number; y: number }) => void;
  /** 메뉴와 확인 창. 화면 어딘가에 그려 둔다. */
  element: ReactNode;
}

/**
 * 작업 중인 변경 한 행의 동작(스테이지, 되돌리기, .gitignore)과 그 우클릭 메뉴·확인 창.
 * 스테이징 목록(`ChangesView`)과 크게 보는 diff 옆 파일 목록이 같이 쓴다.
 */
export function useWorkingFileMenu(repoPath: string | null): WorkingFileMenu {
  const { t } = useTranslation();
  const discardTitleId = useId();
  const conflictStageTitleId = useId();
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [discardTarget, setDiscardTarget] = useState<StatusEntry | null>(null);
  const [conflictStageTarget, setConflictStageTarget] = useState<StatusEntry | null>(null);
  const [menu, setMenu] = useState<{ entry: StatusEntry; x: number; y: number } | null>(null);

  const refreshStatus = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["status"] }),
        queryClient.invalidateQueries({ queryKey: ["fileDiff"] }),
        // 따라가기 목록(`useWipFiles`)도 같은 파일을 보여 준다.
        queryClient.invalidateQueries({ queryKey: ["wipFiles"] }),
      ]),
    [queryClient],
  );

  const handleConfirmDiscard = useCallback(async () => {
    if (!repoPath || !discardTarget) return;
    const target = discardTarget;
    setDiscardTarget(null);
    try {
      await discardChanges(repoPath, entryPaths([target]), target.staged);
      await refreshStatus();
    } catch (err) {
      addToast(t("changes.discardFailed", { error: getErrorMessage(err) }), "error");
    }
  }, [repoPath, discardTarget, refreshStatus, addToast, t]);

  const applyToggleStage = useCallback(
    async (entry: StatusEntry) => {
      if (!repoPath) return;
      try {
        if (entry.staged) await unstageFiles(repoPath, entryPaths([entry]));
        else await stageFiles(repoPath, entryPaths([entry]));
        await refreshStatus();
      } catch (err) {
        const key = entry.staged ? "commit.unstageFailed" : "commit.stageFailed";
        addToast(t(key, { error: getErrorMessage(err) }), "error");
      }
    },
    [repoPath, refreshStatus, addToast, t],
  );

  // 충돌 파일을 스테이징하면 해결된 것으로 처리된다. 충돌 마커가 남아 있으면 먼저 확인한다.
  const toggleStage = useCallback(
    async (entry: StatusEntry) => {
      if (!repoPath) return;
      if (!entry.staged && entry.status === "conflicted") {
        try {
          const marked = await findConflictMarkers(repoPath, [entry.path]);
          if (marked.length > 0) {
            setConflictStageTarget(entry);
            return;
          }
        } catch (err) {
          addToast(t("commit.stageFailed", { error: getErrorMessage(err) }), "error");
          return;
        }
      }
      await applyToggleStage(entry);
    },
    [repoPath, applyToggleStage, addToast, t],
  );

  const handleConfirmConflictStage = useCallback(async () => {
    if (!conflictStageTarget) return;
    const target = conflictStageTarget;
    setConflictStageTarget(null);
    await applyToggleStage(target);
  }, [conflictStageTarget, applyToggleStage]);

  const handleAddToGitignore = useCallback(
    async (path: string) => {
      if (!repoPath) return;
      try {
        await addToGitignore(repoPath, path);
        await refreshStatus();
        addToast(t("changes.addedToGitignore", { path }), "success");
      } catch (err) {
        addToast(getErrorMessage(err), "error");
      }
    },
    [repoPath, refreshStatus, addToast, t],
  );

  const element = (
    <>
      {menu && repoPath && (
        <FileContextMenu
          repoPath={repoPath}
          filePath={menu.entry.path}
          exists={menu.entry.status !== "deleted"}
          working={{
            staged: menu.entry.staged,
            canDiscard: menu.entry.status !== "conflicted",
            onToggleStage: () => void toggleStage(menu.entry),
            onDiscard: () => setDiscardTarget(menu.entry),
            onAddToGitignore: () => void handleAddToGitignore(menu.entry.path),
          }}
          position={{ x: menu.x, y: menu.y }}
          onClose={() => setMenu(null)}
        />
      )}

      {discardTarget && (
        <Dialog
          onClose={() => setDiscardTarget(null)}
          closeOnBackdrop
          labelledBy={discardTitleId}
          className="w-[380px] max-w-[90vw] rounded-xl border border-border bg-card p-5 shadow-xl"
        >
          <h3 id={discardTitleId} className="text-sm font-semibold text-foreground">
            {t("changes.discardConfirmTitle")}
          </h3>
          <p className="mt-2 text-xs text-muted-foreground break-all">
            {t(discardMessageKey(discardTarget), { file: discardTarget.path })}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => setDiscardTarget(null)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border hover:bg-accent transition-colors"
            >
              {t("changes.cancel")}
            </button>
            <button
              onClick={handleConfirmDiscard}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
            >
              {t("changes.discardConfirm")}
            </button>
          </div>
        </Dialog>
      )}

      {conflictStageTarget && (
        <Dialog
          onClose={() => setConflictStageTarget(null)}
          closeOnBackdrop
          labelledBy={conflictStageTitleId}
          className="w-[380px] max-w-[90vw] rounded-xl border border-border bg-card p-5 shadow-xl"
        >
          <h3 id={conflictStageTitleId} className="text-sm font-semibold text-foreground">
            {t("changes.conflictMarkersTitle")}
          </h3>
          <p className="mt-2 text-xs text-muted-foreground break-all">
            {t("changes.conflictMarkersMessage", { file: conflictStageTarget.path })}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => setConflictStageTarget(null)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border hover:bg-accent transition-colors"
            >
              {t("changes.cancel")}
            </button>
            <button
              onClick={handleConfirmConflictStage}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary-hover transition-colors"
            >
              {t("changes.conflictMarkersConfirm")}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );

  return {
    toggleStage,
    askDiscard: setDiscardTarget,
    openMenu: (entry, position) => setMenu({ entry, ...position }),
    element,
  };
}

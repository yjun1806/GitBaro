import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  checkoutCommit,
  resetToCommit,
  revertCommit,
  cherryPickCommit,
  type ResetMode,
} from "@/api/commands";
import { useToastStore } from "@/stores/toast";
import { getErrorMessage } from "@/lib/utils";

/**
 * 커밋 대상 조작(checkout/reset/revert/cherry-pick)을 실행하고, 성공/실패 토스트와
 * 관련 쿼리 무효화를 일괄 처리하는 훅. 확인 다이얼로그는 호출부(메뉴) 책임이다.
 */
export function useCommitActions(repoPath: string | null) {
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const { t } = useTranslation();

  const invalidateAll = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["branches"] }),
        queryClient.invalidateQueries({ queryKey: ["repoSyncStatus"] }),
        queryClient.invalidateQueries({ queryKey: ["commitHistory"] }),
        queryClient.invalidateQueries({ queryKey: ["status"] }),
        queryClient.invalidateQueries({ queryKey: ["mergeState"] }),
        queryClient.invalidateQueries({ queryKey: ["fileDiff"] }),
      ]),
    [queryClient],
  );

  const run = useCallback(
    async (op: () => Promise<void>, successKey: string) => {
      if (!repoPath) return;
      try {
        await op();
        addToast(t(successKey), "success");
      } catch (err) {
        // 충돌로 실패해도 워킹 트리·머지 상태가 이미 바뀌었으므로 아래 finally에서
        // 갱신한다 (충돌 복구 배너가 즉시 뜨도록).
        addToast(getErrorMessage(err), "error");
      } finally {
        await invalidateAll();
      }
    },
    [repoPath, invalidateAll, addToast, t],
  );

  const checkout = useCallback(
    (oid: string) => run(() => checkoutCommit(repoPath!, oid), "history.checkoutSuccess"),
    [run, repoPath],
  );

  const reset = useCallback(
    (oid: string, mode: ResetMode) =>
      run(() => resetToCommit(repoPath!, oid, mode), "history.resetSuccess"),
    [run, repoPath],
  );

  const revert = useCallback(
    (oid: string) => run(() => revertCommit(repoPath!, oid), "history.revertSuccess"),
    [run, repoPath],
  );

  const cherryPick = useCallback(
    (oid: string) => run(() => cherryPickCommit(repoPath!, oid), "history.cherryPickSuccess"),
    [run, repoPath],
  );

  return { checkout, reset, revert, cherryPick };
}

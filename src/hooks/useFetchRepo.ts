import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { gitFetch } from "@/api/commands";
import { invalidateAfterSync } from "@/api/queries";
import { useSyncStore } from "@/stores/sync";
import { useToastStore } from "@/stores/toast";
import { remoteErrorKey, signInErrorAccount } from "@/lib/remote-error";
import { getErrorMessage } from "@/lib/utils";
import type { RepoInfo } from "@/types";

/**
 * 저장소 하나를 fetch한다(사이드바 우클릭 메뉴). 툴바 Fetch와 같은 규칙: 저장소에 지정된 계정으로만,
 * 진행 상태는 그 저장소에 묶고, 끝나면 마지막 fetch 시각을 적고 동기화 뒤 조회를 다시 읽는다.
 */
export function useFetchRepo(): (repo: RepoInfo) => Promise<void> {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return useCallback(
    async (repo: RepoInfo) => {
      const { addToast } = useToastStore.getState();
      const sync = useSyncStore.getState();
      if (!repo.accountId) {
        addToast(t("sync.noRepoAccountDesc"), "warning");
        return;
      }
      if (sync.syncingByRepo[repo.path]) return;
      sync.startSync(repo.path, "fetch");
      try {
        await gitFetch(repo.path, repo.accountId);
        useSyncStore.getState().markFetched(repo.path, Math.floor(Date.now() / 1000));
        await invalidateAfterSync(queryClient);
        addToast(t("sync.fetchCompleted"), "success");
      } catch (err) {
        const signInAccount = signInErrorAccount(err);
        const msg = getErrorMessage(err);
        const key = remoteErrorKey(msg);
        if (signInAccount) addToast(t("sync.signInExpired", { account: signInAccount }), "error");
        else addToast(key ? t(key) : t("sync.fetchFailed", { error: msg }), "error");
      } finally {
        useSyncStore.getState().finishSync(repo.path);
      }
    },
    [t, queryClient],
  );
}

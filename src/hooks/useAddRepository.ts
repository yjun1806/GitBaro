import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { addLocalRepository, cloneRepository } from "@/api/commands";
import { getErrorMessage, isAppErrorType, isSameFolder } from "@/lib/utils";
import { useAccountStore } from "@/stores/account";
import { useRepositoryStore } from "@/stores/repository";
import { useToastStore } from "@/stores/toast";
import type { RepoInfo } from "@/types";

export interface CloneParams {
  url: string;
  localPath: string;
  accountId: string | null;
}

export interface AddRepository {
  /** 폴더를 골라 로컬 저장소를 더한다. 계정이 둘 이상이면 계정 고르기를 기다린다. */
  addLocal: () => Promise<void>;
  /** 복제한 뒤 목록에 더하고 연다. 실패하면 예외를 그대로 던진다(`CloneDialog`가 보여 준다). */
  clone: (params: CloneParams) => Promise<void>;
  /** 계정 고르기를 기다리는 로컬 저장소. 있으면 `AccountSelectDialog`를 띄운다. */
  pendingLocalRepo: RepoInfo | null;
  /** 계정을 고르면(또는 닫으면 null로) 기다리던 저장소를 더한다. */
  resolvePendingAccount: (accountId: string | null) => void;
}

/**
 * 저장소 추가(로컬 폴더, 복제)의 공통 흐름. `RepoListView`와 같은 규칙을 따른다:
 * 고른 폴더가 더 위쪽 저장소 안에 있으면 그 저장소를 더할지 묻고, 계정이 둘 이상이면
 * 기본 계정을 고르게 하고, 하나뿐이면 그 계정을 붙인다. 더한 뒤 `onAdded`로 연다.
 */
export function useAddRepository(onAdded: (path: string) => void): AddRepository {
  const { t } = useTranslation();
  const addRepo = useRepositoryStore((s) => s.addRepo);
  const addToast = useToastStore((s) => s.addToast);
  const [pendingLocalRepo, setPendingLocalRepo] = useState<RepoInfo | null>(null);

  const addLocal = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected !== "string") return;
      const repoInfo = await addLocalRepository(selected);
      // 고른 폴더가 더 위쪽 저장소(홈 폴더일 수도 있다) 안에 있을 수 있다. 그 저장소를 더할지는 사용자가 정한다.
      if (!isSameFolder(selected, repoInfo.path)) {
        const confirmed = await ask(
          t("repo.addEnclosingConfirm", { picked: selected, root: repoInfo.path }),
          { title: t("repo.addEnclosingTitle"), kind: "warning" },
        );
        if (!confirmed) return;
      }
      const accounts = useAccountStore.getState().accounts;
      if (accounts.length >= 2) {
        setPendingLocalRepo(repoInfo);
        return;
      }
      addRepo({ ...repoInfo, accountId: accounts.length === 1 ? accounts[0].id : null });
      onAdded(repoInfo.path);
    } catch (err) {
      addToast(
        isAppErrorType(err, "BareRepository")
          ? t("repo.bareNotSupported")
          : t("repo.failedToAdd", { error: getErrorMessage(err) }),
        "error",
      );
    }
  }, [addRepo, addToast, onAdded, t]);

  const clone = useCallback(
    async ({ url, localPath, accountId }: CloneParams) => {
      const repoInfo = await cloneRepository(url, localPath, accountId ?? undefined);
      addRepo(accountId ? { ...repoInfo, accountId } : repoInfo);
      onAdded(repoInfo.path);
      addToast(t("clone.success"), "success");
    },
    [addRepo, addToast, onAdded, t],
  );

  const resolvePendingAccount = useCallback(
    (accountId: string | null) => {
      // 대화 상자를 먼저 닫는다. 추가가 실패해도 대화 상자가 열린 채로 남지 않게.
      const repoInfo = pendingLocalRepo;
      setPendingLocalRepo(null);
      if (!repoInfo) return;
      addRepo({ ...repoInfo, accountId });
      onAdded(repoInfo.path);
    },
    [pendingLocalRepo, addRepo, onAdded],
  );

  return { addLocal, clone, pendingLocalRepo, resolvePendingAccount };
}

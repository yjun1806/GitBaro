import { useState, useRef } from "react";
import {
  RefreshCw,
  ArrowUp,
  ArrowDown,
  Loader2,
  ChevronDown,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRepositoryStore } from "@/stores/repository";
import { useUIStore } from "@/stores/ui";
import { useActivityStore } from "@/stores/activity";
import { useSyncStore, type SyncAction } from "@/stores/sync";
import { invalidateAfterSync, useBranches, useHeadDetached, useTokenValidation } from "@/api/queries";
import { gitFetch, gitPush, gitPull, getPushTarget } from "@/api/commands";
import type { PushTarget } from "@/types";
import { useQueryClient } from "@tanstack/react-query";
import { useToastStore } from "@/stores/toast";
import { useRepoAccountId } from "@/hooks/useRepoAccountId";
import { cn, getErrorMessage, isMergeConflictError } from "@/lib/utils";
import { useClickOutside } from "./useToolbarDropdown";
import { SyncDropdown } from "./SyncDropdown";
import { AutoSyncHint } from "./AutoSyncHint";
import { ConfirmCommandDialog } from "@/components/ui/ConfirmCommandDialog";

interface SyncZoneProps {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}

const FAILURE_KEYS: Record<SyncAction, string> = {
  fetch: "sync.fetchFailed",
  pull: "sync.pullFailed",
  push: "sync.pushFailed",
  publish: "sync.publishFailed",
};

/** 백엔드가 코드로 돌려주는 원격 선택 오류를 번역 키로 바꾼다. */
function remoteErrorKey(message: string): string | null {
  if (message.startsWith("no_upstream:")) return "sync.noUpstreamError";
  if (message === "no_remote") return "sync.noRemoteError";
  if (message === "multiple_remotes") return "sync.multipleRemotesError";
  if (message === "detached_head") return "sync.detachedHeadError";
  return null;
}

export function SyncZone({ isOpen, onToggle, onClose }: SyncZoneProps) {
  const zoneRef = useRef<HTMLDivElement>(null);
  useClickOutside(zoneRef, onClose, isOpen);
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  // 전역 활성 계정이 아니라 이 저장소에 지정된 계정으로 동기화한다.
  const accountId = useRepoAccountId();
  const { data: branches = [] } = useBranches(activeRepoPath);
  const { data: isDetached = false } = useHeadDetached(activeRepoPath);
  const { data: tokenStatus, isLoading: isValidating } = useTokenValidation(accountId, activeRepoPath);

  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const activeOperations = useActivityStore((s) => s.activeOperations);

  // 진행 상태와 마지막 fetch 시각은 저장소별이다. 다른 저장소의 push가 이 저장소를 막지 않는다.
  const syncingAction = useSyncStore((s) =>
    activeRepoPath ? s.syncingByRepo[activeRepoPath] ?? null : null,
  );
  const lastFetchedAt = useSyncStore((s) =>
    activeRepoPath ? s.lastFetchedByRepo[activeRepoPath] ?? null : null,
  );
  const startSync = useSyncStore((s) => s.startSync);
  const finishSync = useSyncStore((s) => s.finishSync);
  const markFetched = useSyncStore((s) => s.markFetched);
  // force push 확인 창에 보여줄 실제 push 대상. null이면 창이 닫혀 있다.
  const [forcePushTarget, setForcePushTarget] = useState<PushTarget | null>(null);

  const isSyncing = syncingAction !== null;

  const headBranch = branches.find((b) => b.isHead);
  const ahead = headBranch?.aheadBehind?.ahead ?? 0;
  const behind = headBranch?.aheadBehind?.behind ?? 0;
  const hasUpstream = headBranch?.upstream != null;
  // A detached HEAD has no branch to publish (the backend refuses to push or
  // pull it), so only fetch is offered there.
  const needsPublish = !hasUpstream && !isDetached;

  const previewBranch = useUIStore((s) => s.previewBranch);
  // canPush is null for non-GitHub remotes: push access is unknown, so let git decide.
  const canSync = tokenStatus?.valid === true && tokenStatus?.canPush !== false;
  const syncDisabled = isSyncing || !accountId || (!isValidating && !canSync) || !!previewBranch;

  // Find this repo's active remote operation progress
  const activeRemoteOp = Object.values(activeOperations).find(
    (op) =>
      op.repoPath === activeRepoPath &&
      (op.operation === "fetch" || op.operation === "push" || op.operation === "pull"),
  );
  const progressPercent = activeRemoteOp?.progress?.percent;

  const syncError = (() => {
    // 계정이 지정되지 않은 저장소는 다른 저장소의 계정으로 동기화하지 않는다.
    if (activeRepoPath && !accountId) return { title: t("sync.noRepoAccount"), description: t("sync.noRepoAccountDesc") };
    if (!accountId || isValidating || canSync) return null;
    if (!tokenStatus?.valid) {
      if (tokenStatus?.reason === "token_not_found") return { title: t("sync.tokenMissing"), description: t("sync.tokenMissingDesc") };
      if (tokenStatus?.reason === "network_error") return { title: t("sync.networkError"), description: t("sync.networkErrorDesc") };
      return { title: t("sync.sessionExpired"), description: t("sync.sessionExpiredDesc") };
    }
    if (tokenStatus?.canPush === false) {
      if (tokenStatus?.reason === "repo_not_found") return { title: t("sync.repoNotFound"), description: t("sync.repoNotFoundDesc") };
      return { title: t("sync.readOnly"), description: t("sync.readOnlyDesc") };
    }
    return null;
  })();

  const invalidateAll = (includeActions = false) => {
    const queries = invalidateAfterSync(queryClient);
    if (includeActions) {
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["workflowRuns"] });
      }, 5000);
    }
    return queries;
  };

  /**
   * 동기화 작업 하나를 실행한다. 진행 상태는 시작한 저장소에 묶고, 실패 문구는
   * 실제로 실행한 작업(action)으로 고른다.
   */
  const runSync = async (
    action: SyncAction,
    run: (repoPath: string, account: string) => Promise<void>,
    successMessage: string,
  ) => {
    const repoPath = activeRepoPath;
    if (!repoPath || !accountId) return;
    startSync(repoPath, action);
    try {
      await run(repoPath, accountId);
      if (action !== "push" && action !== "publish") {
        markFetched(repoPath, Math.floor(Date.now() / 1000));
      }
      await invalidateAll(action === "push" || action === "publish");
      addToast(successMessage, "success");
    } catch (err) {
      if (action === "pull") {
        // pull이 충돌로 멈춰도 작업 트리와 merge 상태는 이미 바뀌었다.
        // 목록을 갱신해야 merge 중단·계속 배너가 뜬다.
        await invalidateAll();
      }
      if (isMergeConflictError(err)) {
        addToast(t("sync.pullConflict"), "warning");
        setActiveTab("changes");
        return;
      }
      const msg = getErrorMessage(err);
      const remoteKey = remoteErrorKey(msg);
      addToast(remoteKey ? t(remoteKey) : t(FAILURE_KEYS[action], { error: msg }), "error");
    } finally {
      finishSync(repoPath);
    }
  };

  const handleSync = async () => {
    if (!activeRepoPath || isSyncing) return;
    if (syncError) {
      addToast(`${syncError.title}: ${syncError.description}`, "error");
      return;
    }
    if (!accountId) return;
    const action: SyncAction = needsPublish ? "publish" : behind > 0 ? "pull" : ahead > 0 ? "push" : "fetch";
    if (action === "pull") {
      await runSync(action, (path, account) => gitPull(path, account), t("sync.pullCompleted"));
    } else if (action === "push" || action === "publish") {
      await runSync(action, (path, account) => gitPush(path, account), t("sync.pushCompleted"));
    } else {
      await runSync(action, (path, account) => gitFetch(path, account), t("sync.fetchCompleted"));
    }
  };

  const handleFetch = async () => {
    if (isSyncing) return;
    await runSync("fetch", (path, account) => gitFetch(path, account), t("sync.fetchCompleted"));
  };

  const handlePull = async (rebase?: boolean) => {
    if (isSyncing) return;
    await runSync(
      "pull",
      (path, account) => gitPull(path, account, rebase),
      rebase ? t("sync.pullRebaseCompleted") : t("sync.pullCompleted"),
    );
  };

  const handlePush = async (force = false) => {
    if (!activeRepoPath || !accountId || isSyncing) return;
    if (force) {
      // 확인 창에는 백엔드가 실제로 실행할 원격과 refspec을 보여준다.
      try {
        setForcePushTarget(await getPushTarget(activeRepoPath));
      } catch (err) {
        const msg = getErrorMessage(err);
        const remoteKey = remoteErrorKey(msg);
        addToast(remoteKey ? t(remoteKey) : t(FAILURE_KEYS.push, { error: msg }), "error");
      }
      return;
    }
    await runSync(
      needsPublish ? "publish" : "push",
      (path, account) => gitPush(path, account, false),
      t("sync.pushCompleted"),
    );
  };

  const handleForcePushConfirmed = async () => {
    await runSync("push", (path, account) => gitPush(path, account, true), t("sync.forcePushCompleted"));
  };

  // State-driven visual
  const stateConfig = (() => {
    if (isSyncing) return {
      icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />,
      label: syncingAction === "pull" ? t("sync.pulling") : syncingAction === "fetch" ? t("sync.fetching") : t("sync.pushing"),
      accent: "text-primary",
      bg: "bg-primary/5 border-primary/20",
    };
    if (syncError) return {
      icon: <RefreshCw className="w-3.5 h-3.5" />,
      label: syncError.title,
      accent: "text-danger",
      bg: "bg-danger/5 border-danger/20",
    };
    if (needsPublish) return {
      icon: <ArrowUp className="w-3.5 h-3.5" />,
      label: t("sync.publishBranch"),
      accent: "text-primary",
      bg: "border-primary/20 hover:bg-primary/5",
    };
    if (behind > 0) return {
      icon: <ArrowDown className="w-3.5 h-3.5" />,
      label: t("toolbar.pull"),
      accent: "text-primary",
      bg: "border-primary/20 hover:bg-primary/5",
    };
    if (ahead > 0) return {
      icon: <ArrowUp className="w-3.5 h-3.5" />,
      label: t("toolbar.push"),
      accent: "text-primary",
      bg: "border-primary/20 hover:bg-primary/5",
    };
    return {
      icon: <RefreshCw className="w-3.5 h-3.5" />,
      label: t("toolbar.fetch"),
      accent: "text-muted-foreground",
      bg: "border-transparent hover:border-border hover:bg-accent",
    };
  })();

  const hasCount = !syncError && (ahead > 0 || behind > 0);

  return (
    <div ref={zoneRef} className="relative flex items-center shrink-0 pr-2">
      <AutoSyncHint />
      {/* Split-button group */}
      <div className={cn(
        "flex items-center h-8 rounded-lg border transition-all",
        isOpen ? "border-primary/30 bg-primary/5 shadow-sm" : stateConfig.bg,
        syncDisabled && !syncError && "opacity-50",
      )}>
        {/* Main action */}
        <button
          onClick={handleSync}
          disabled={!syncError && syncDisabled}
          className={cn(
            "flex items-center gap-1.5 h-full pl-2.5 pr-2 rounded-l-lg transition-colors",
            !syncDisabled && !syncError && "hover:bg-accent",
            syncError && "cursor-pointer",
            stateConfig.accent,
          )}
        >
          {stateConfig.icon}
          <span className="text-sm font-semibold whitespace-nowrap">{stateConfig.label}</span>
          {isSyncing && progressPercent !== undefined && (
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {t("activity.progress", { percent: progressPercent })}
            </span>
          )}
          {hasCount && (
            <span className="bg-primary text-primary-foreground text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 tabular-nums leading-none">
              {behind > 0 ? behind : ahead}
            </span>
          )}
        </button>

        {/* Divider + dropdown trigger */}
        <div className="w-px h-4 bg-border/60" />
        <button
          onClick={onToggle}
          className="flex items-center justify-center w-7 h-full rounded-r-lg hover:bg-accent transition-colors"
        >
          <ChevronDown className={cn(
            "w-3 h-3 text-muted-foreground transition-transform",
            isOpen && "rotate-180",
          )} />
        </button>
      </div>

      {isOpen && (
        <SyncDropdown
          ahead={ahead}
          behind={behind}
          hasUpstream={!needsPublish}
          lastFetchedAt={lastFetchedAt}
          disabled={syncDisabled}
          onFetch={handleFetch}
          onPull={handlePull}
          onPush={handlePush}
          onClose={onClose}
        />
      )}

      {forcePushTarget && (
        <ConfirmCommandDialog
          title={t("sync.forcePushConfirmTitle")}
          command={`git push --force-with-lease ${forcePushTarget.remote} ${forcePushTarget.refspec}`}
          warnings={[t("sync.forcePushWarning")]}
          confirmVariant="destructive"
          onConfirm={handleForcePushConfirmed}
          onClose={() => setForcePushTarget(null)}
        />
      )}
    </div>
  );
}

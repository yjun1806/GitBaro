import { useState, useRef } from "react";
import { RefreshCw, ArrowUp, ArrowDown, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRepositoryStore } from "@/stores/repository";
import { useUIStore } from "@/stores/ui";
import { useActivityStore } from "@/stores/activity";
import { useSyncStore, type SyncAction } from "@/stores/sync";
import {
  invalidateAfterSync,
  useBranches,
  useHeadDetached,
  useRepoSyncStatuses,
  useTokenValidation,
} from "@/api/queries";
import { gitFetch, gitPush, gitPull, getPushTarget } from "@/api/commands";
import type { PushTarget, RemoteOp } from "@/types";
import { useQueryClient } from "@tanstack/react-query";
import { useToastStore } from "@/stores/toast";
import { useRepoAccountId } from "@/hooks/useRepoAccountId";
import { cn, formatRelativeTime, getErrorMessage, isMergeConflictError } from "@/lib/utils";
import { remoteErrorKey } from "@/lib/remote-error";
import { useClickOutside } from "./useToolbarDropdown";
import { AutoSyncHint } from "./AutoSyncHint";
import { ActionButton, ActionGroup, ActionMenu, TOOLBAR_WIDE_LABEL_CLASS } from "./ActionButton";
import { TOOLBAR_ICON, toolbarButtonClass } from "./toolbar-button";
import { ConfirmCommandDialog } from "@/components/ui/ConfirmCommandDialog";
import { MultiRepoRemoteDialog } from "@/components/review/MultiRepoRemoteDialog";

type SyncZoneProps = { mode: "repo" } | { mode: "workspace"; paths: string[] };

/** 시안 `toolbar()`의 첫 묶음: Fetch · Pull · Push(↑ 배지). */
export function SyncZone(props: SyncZoneProps) {
  return props.mode === "workspace" ? <WorkspaceSyncZone paths={props.paths} /> : <RepoSyncGroup />;
}

const REMOTE_OPS: { op: RemoteOp; icon: typeof RefreshCw; labelKey: string }[] = [
  { op: "fetch", icon: RefreshCw, labelKey: "gitActions.fetch" },
  { op: "pull", icon: ArrowDown, labelKey: "gitActions.pull" },
  { op: "push", icon: ArrowUp, labelKey: "gitActions.push" },
];

/**
 * 워크스페이스 모드의 연결 자리. 세 버튼은 저장소별 명령을 보여 주는 확인 창(W5-T2)만 연다.
 * 확인 창을 거치지 않고 여러 저장소에서 바로 실행하는 경로는 없다.
 */
function WorkspaceSyncZone({ paths }: { paths: string[] }) {
  const [pendingOp, setPendingOp] = useState<RemoteOp | null>(null);
  return (
    <>
      <WorkspaceSyncGroup paths={paths} onMultiRepo={setPendingOp} />
      {pendingOp && (
        <MultiRepoRemoteDialog paths={paths} op={pendingOp} onClose={() => setPendingOp(null)} />
      )}
    </>
  );
}

/**
 * 워크스페이스 모드의 세 버튼. 누르면 `onMultiRepo(op)`를 부르고, 저장소마다 명령을 확인하는 창은
 * 그쪽이 띄운다. 배지는 워크스페이스 저장소들의 ↑·↓ 합계다(마지막 fetch 기준, 사이드바와 같은 값).
 */
export function WorkspaceSyncGroup({
  paths,
  onMultiRepo,
}: {
  paths: string[];
  onMultiRepo?: (op: RemoteOp) => void;
}) {
  const { t } = useTranslation();
  const { data: syncByPath } = useRepoSyncStatuses(paths);
  const totals = paths.reduce(
    (acc, path) => {
      const status = syncByPath?.[path];
      return status
        ? { ahead: acc.ahead + status.ahead, behind: acc.behind + status.behind }
        : acc;
    },
    { ahead: 0, behind: 0 },
  );
  const badges: Record<RemoteOp, { badge?: number; badgePrefix?: string }> = {
    fetch: {},
    pull: { badge: totals.behind, badgePrefix: "↓" },
    push: { badge: totals.ahead, badgePrefix: "↑" },
  };
  const hint = onMultiRepo ? undefined : t("activeScope.pickRepo");
  return (
    <ActionGroup label={t("gitActions.syncGroup")}>
      {REMOTE_OPS.map(({ op, icon, labelKey }) => (
        <ActionButton
          key={op}
          action={op}
          icon={icon}
          label={t(labelKey)}
          disabled={!onMultiRepo}
          hint={hint}
          {...badges[op]}
          highlighted={(badges[op].badge ?? 0) > 0}
          onClick={onMultiRepo ? () => onMultiRepo(op) : undefined}
        />
      ))}
    </ActionGroup>
  );
}

const FAILURE_KEYS: Record<SyncAction, string> = {
  fetch: "sync.fetchFailed",
  pull: "sync.pullFailed",
  push: "sync.pushFailed",
  publish: "sync.publishFailed",
};

/** 저장소 모드: 지금 연 저장소(또는 워크트리)에서 바로 실행한다. */
function RepoSyncGroup() {
  const zoneRef = useRef<HTMLDivElement>(null);
  const [openMenu, setOpenMenu] = useState<"fetch" | "pull" | "push" | null>(null);
  const closeMenu = () => setOpenMenu(null);
  useClickOutside(zoneRef, closeMenu, openMenu !== null);
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


  const handleSyncErrorClick = () => {
    if (syncError) addToast(`${syncError.title}: ${syncError.description}`, "error");
  };

  const busyLabel = (action: SyncAction) =>
    action === "pull" ? t("sync.pulling") : action === "fetch" ? t("sync.fetching") : t("sync.pushing");
  const progressSuffix =
    isSyncing && progressPercent !== undefined ? ` ${t("activity.progress", { percent: progressPercent })}` : "";
  const fetchHint = lastFetchedAt
    ? t("sync.lastFetched", { time: formatRelativeTime(lastFetchedAt) })
    : t("sync.neverFetched");
  // 분리된 HEAD는 올리거나 받을 브랜치가 없다(백엔드가 거부한다). Fetch만 연다.
  const branchOpsDisabled = syncDisabled || isDetached;
  const pushLabel = needsPublish ? t("gitActions.publish") : t("gitActions.push");
  // 올릴 커밋이 없으면 Push를 끈다. 추적 브랜치가 없으면 첫 push(publish)는 연다.
  const pushDisabled = branchOpsDisabled || (!needsPublish && ahead === 0);
  const pullDisabled = branchOpsDisabled || needsPublish;
  const toggleMenu = (id: "fetch" | "pull" | "push") => setOpenMenu((prev) => (prev === id ? null : id));

  return (
    <div ref={zoneRef} className="relative flex items-center gap-1 shrink-0">
      {/* 좁은 툴바에서는 자동 최신화 안내를 숨긴다. 같은 내용은 설정에서 볼 수 있다. */}
      <span className="hidden @min-[1280px]:contents">
        <AutoSyncHint />
      </span>
      {syncError && (
        <button
          type="button"
          onClick={handleSyncErrorClick}
          title={syncError.description}
          aria-label={`${syncError.title} — ${syncError.description}`}
          className={cn(toolbarButtonClass(), "text-danger hover:text-danger")}
        >
          <AlertTriangle className={TOOLBAR_ICON} aria-hidden="true" />
          <span className={cn("whitespace-nowrap", TOOLBAR_WIDE_LABEL_CLASS)}>{syncError.title}</span>
        </button>
      )}
      <ActionGroup label={t("gitActions.syncGroup")}>
        <ActionButton
          action="fetch"
          icon={RefreshCw}
          label={syncingAction === "fetch" ? busyLabel("fetch") + progressSuffix : t("gitActions.fetch")}
          busy={syncingAction === "fetch"}
          disabled={syncDisabled}
          hint={fetchHint}
          onClick={handleFetch}
          menu={{
            label: t("gitActions.fetchOptions"),
            isOpen: openMenu === "fetch",
            onToggle: () => toggleMenu("fetch"),
          }}
        />
        <ActionButton
          action="pull"
          icon={ArrowDown}
          label={syncingAction === "pull" ? busyLabel("pull") + progressSuffix : t("gitActions.pull")}
          busy={syncingAction === "pull"}
          disabled={pullDisabled}
          badge={behind}
          badgePrefix="↓"
          highlighted={behind > 0}
          onClick={() => handlePull()}
          menu={{
            label: t("gitActions.pullOptions"),
            isOpen: openMenu === "pull",
            onToggle: () => toggleMenu("pull"),
            disabled: pullDisabled,
          }}
        />
        <ActionButton
          action="push"
          icon={ArrowUp}
          label={
            syncingAction === "push" || syncingAction === "publish"
              ? busyLabel("push") + progressSuffix
              : pushLabel
          }
          busy={syncingAction === "push" || syncingAction === "publish"}
          disabled={pushDisabled}
          badge={ahead}
          badgePrefix="↑"
          highlighted={ahead > 0 || needsPublish}
          onClick={() => handlePush(false)}
          menu={{
            label: t("gitActions.pushOptions"),
            isOpen: openMenu === "push",
            onToggle: () => toggleMenu("push"),
            // 올릴 커밋이 없어도(ahead 0) force push는 필요할 수 있다. 이미 올린 커밋을 되돌린 뒤가 그렇다.
            disabled: branchOpsDisabled,
          }}
        />
      </ActionGroup>

      {openMenu === "fetch" && (
        <ActionMenu
          onClose={closeMenu}
          items={[
            {
              key: "fetch",
              label: t("gitActions.fetchNow"),
              description: fetchHint,
              disabled: syncDisabled,
              onSelect: () => handleFetch(),
            },
          ]}
        />
      )}

      {openMenu === "pull" && (
        <ActionMenu
          onClose={closeMenu}
          items={[
            {
              key: "merge",
              label: t("sync.pullOrigin"),
              description: behind > 0 ? t("sync.pullDescription") : t("sync.noRemoteChanges"),
              disabled: pullDisabled,
              onSelect: () => handlePull(),
            },
            {
              key: "rebase",
              label: t("gitActions.pullRebase"),
              description: t("gitActions.pullRebaseDesc"),
              disabled: pullDisabled,
              onSelect: () => handlePull(true),
            },
          ]}
        />
      )}

      {openMenu === "push" && (
        <ActionMenu
          onClose={closeMenu}
          items={[
            needsPublish
              ? {
                  key: "publish",
                  label: t("sync.publishBranch"),
                  description: t("sync.publishBranchDesc"),
                  disabled: branchOpsDisabled,
                  onSelect: () => handlePush(false),
                }
              : {
                  key: "push",
                  label: t("sync.pushOrigin"),
                  description: ahead > 0 ? t("sync.pushDescription") : t("sync.noLocalCommits"),
                  disabled: pushDisabled,
                  onSelect: () => handlePush(false),
                },
            {
              key: "force",
              label: t("gitActions.forcePush"),
              description: t("gitActions.forcePushDesc"),
              danger: true,
              disabled: branchOpsDisabled || needsPublish,
              onSelect: () => handlePush(true),
            },
          ]}
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

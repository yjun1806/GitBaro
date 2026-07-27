import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getStatus,
  getBranches,
  getBranchDivergence,
  getRepoSyncStatus,
  getRecentBranches,
  getCommitHistory,
  getCommitDetail,
  getCommitFileDiff,
  getAccounts,
  getRepoAccount,
  getSettings,
  getFileDiff,
  validateToken,
  checkGhStatus,
  resolveCommitAvatars,
  compareBranches,
  checkMergeConflicts,
  getWorktrees,
  stashList,
  stashShow,
  stashApply,
  stashDrop,
  stashPush,
  stashPop,
  stashPushPartial,
  listWorkflowRuns,
  getWorkflowRunJobs,
  listRemoteTags,
  getMergeState,
  abortMergeOrRebase,
  continueMergeOrRebase,
} from "./commands";
import type { RepoSyncStatus } from "@/types";

export function useStatus(repoPath: string | null) {
  return useQuery({
    queryKey: ["status", repoPath],
    queryFn: () => getStatus(repoPath!),
    enabled: repoPath !== null,
    staleTime: 0,
    // The FS watcher (useRepoWatcher) invalidates this query on file changes,
    // so tight polling is unnecessary. Keep a slow, foreground-only poll as a
    // safety net for changes the watcher might miss (network drives, etc.).
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export function useBranches(repoPath: string | null) {
  return useQuery({
    queryKey: ["branches", repoPath],
    queryFn: () => getBranches(repoPath!),
    enabled: repoPath !== null,
  });
}

/**
 * 각 브랜치의 현재 HEAD 대비 ahead/behind. 브랜치 수가 많은 저장소에서 비싼
 * 계산이라 `get_branches`에서 분리했고, 비교 셀렉터가 열릴 때(enabled)만 조회한다.
 *
 * 값이 HEAD에 의존하므로 캐시를 신선하게 유지하지 않는다(staleTime 0). 브랜치
 * 전환·커밋으로 HEAD가 바뀐 뒤 셀렉터를 다시 열면 항상 최신 HEAD 기준으로
 * 재계산된다. enabled=isOpen이라 열지 않으면 계산 자체가 일어나지 않는다.
 */
export function useBranchDivergence(repoPath: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["branchDivergence", repoPath],
    queryFn: () => getBranchDivergence(repoPath!),
    enabled: repoPath !== null && enabled,
  });
}

/**
 * 여러 레포의 push/pull 필요 상태(ahead/behind)를 한 번에 조회한다.
 * 경로별 `RepoSyncStatus` 맵으로 반환하며, 마지막 fetch 시점 기준이므로
 * 백그라운드 fetch(useBackgroundFetch) 완료 시 `["repoSyncStatus"]` 무효화로
 * 갱신된다. 키를 정렬된 경로 목록으로 삼아 레포 목록 변화에만 반응한다.
 */
export function useRepoSyncStatuses(repoPaths: string[]) {
  const sortedPaths = [...repoPaths].sort();
  return useQuery({
    queryKey: ["repoSyncStatus", sortedPaths],
    queryFn: () => getRepoSyncStatus(sortedPaths),
    enabled: sortedPaths.length > 0,
    staleTime: 15_000,
    // 오프라인 libgit2 계산이라 저비용 — 전체 레포의 dirty/ahead가 이벤트 없이도
    // 주기적으로 갱신되도록 포그라운드 폴링을 둔다. behind는 별도 background fetch가 갱신.
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
    select: (statuses): Record<string, RepoSyncStatus> =>
      Object.fromEntries(statuses.map((s) => [s.path, s])),
  });
}

/** 커밋 히스토리 페이지 크기 — 스크롤 시 이 단위로 추가 로드한다. */
const COMMIT_HISTORY_PAGE_SIZE = 50;

/**
 * 커밋 히스토리를 무한 스크롤로 조회한다. 백엔드 get_commit_history의 offset을
 * 활용해 스크롤 시 다음 페이지를 이어 붙인다. 마지막 페이지가 페이지 크기보다
 * 적으면 끝으로 판단한다. 키 접두어를 ["commitHistory"]로 유지해 기존 무효화
 * (commit·switch·fetch 등)가 그대로 적용된다.
 */
export function useCommitHistoryInfinite(repoPath: string | null) {
  return useInfiniteQuery({
    queryKey: ["commitHistory", repoPath],
    queryFn: ({ pageParam }) => getCommitHistory(repoPath!, COMMIT_HISTORY_PAGE_SIZE, pageParam),
    enabled: repoPath !== null,
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === COMMIT_HISTORY_PAGE_SIZE
        ? allPages.length * COMMIT_HISTORY_PAGE_SIZE
        : undefined,
  });
}

/**
 * origin에 존재하는 태그 이름 목록. 히스토리에서 로컬 전용 태그를 구분하는 데
 * 쓴다. 네트워크 호출이므로 저장소·계정이 모두 있을 때만 실행하고, push/fetch
 * 성공 시 ["remoteTags"] 키를 무효화해 갱신한다.
 */
export function useRemoteTags(repoPath: string | null, accountId: string | null) {
  return useQuery({
    queryKey: ["remoteTags", repoPath, accountId],
    queryFn: () => listRemoteTags(repoPath!, accountId!),
    enabled: repoPath !== null && accountId !== null,
    staleTime: 60_000,
  });
}

export function useAccounts() {
  return useQuery({
    queryKey: ["accounts"],
    queryFn: getAccounts,
  });
}

export function useRepoAccount(repoPath: string | null, remoteName: string) {
  return useQuery({
    queryKey: ["repoAccount", repoPath, remoteName],
    queryFn: () => getRepoAccount(repoPath!, remoteName),
    enabled: repoPath !== null,
  });
}

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
  });
}

export function useFileDiff(repoPath: string | null, filePath: string | null, staged: boolean) {
  return useQuery({
    queryKey: ["fileDiff", repoPath, filePath, staged],
    queryFn: () => getFileDiff(repoPath!, filePath!, staged),
    enabled: repoPath !== null && filePath !== null,
  });
}

export function useTokenValidation(accountId: string | null, repoPath: string | null) {
  return useQuery({
    queryKey: ["tokenValidation", accountId, repoPath],
    queryFn: () => validateToken(accountId!, repoPath!),
    enabled: accountId !== null && repoPath !== null,
    retry: false,
  });
}

export function useCommitDetail(repoPath: string | null, oid: string | null) {
  return useQuery({
    queryKey: ["commitDetail", repoPath, oid],
    queryFn: () => getCommitDetail(repoPath!, oid!),
    enabled: repoPath !== null && oid !== null,
  });
}

export function useCommitFileDiff(repoPath: string | null, oid: string | null, filePath: string | null) {
  return useQuery({
    queryKey: ["commitFileDiff", repoPath, oid, filePath],
    queryFn: () => getCommitFileDiff(repoPath!, oid!, filePath!),
    enabled: repoPath !== null && oid !== null && filePath !== null,
  });
}

export function useCommitAvatars(repoPath: string | null) {
  return useQuery({
    queryKey: ["commitAvatars", repoPath],
    queryFn: () => resolveCommitAvatars(repoPath!),
    enabled: repoPath !== null,
    staleTime: 5 * 60 * 1000, // 5min cache
    retry: false,
  });
}

export function useBranchComparison(
  repoPath: string | null,
  baseBranch: string | null,
  compareBranch: string | null,
) {
  return useQuery({
    queryKey: ["branchComparison", repoPath, baseBranch, compareBranch],
    queryFn: () => compareBranches(repoPath!, baseBranch!, compareBranch!),
    enabled: repoPath !== null && baseBranch !== null && compareBranch !== null,
  });
}

export function useMergeConflictCheck(
  repoPath: string | null,
  branch: string | null,
) {
  return useQuery({
    queryKey: ["mergeConflictCheck", repoPath, branch],
    queryFn: () => checkMergeConflicts(repoPath!, branch!),
    enabled: repoPath !== null && branch !== null,
    staleTime: 30_000,
    retry: false,
  });
}

export function useGhStatus() {
  return useQuery({
    queryKey: ["ghStatus"],
    queryFn: checkGhStatus,
    staleTime: 60_000,
  });
}

export function useWorktrees(repoPath: string | null) {
  return useQuery({
    queryKey: ["worktrees", repoPath],
    queryFn: () => getWorktrees(repoPath!),
    enabled: repoPath !== null,
  });
}

export function useRecentBranches(repoPath: string | null, limit = 5) {
  return useQuery({
    queryKey: ["recentBranches", repoPath, limit],
    queryFn: () => getRecentBranches(repoPath!, limit),
    enabled: repoPath !== null,
  });
}

// ── Stash ────────────────────────────────────────────────────────────────────

export function useStashList(repoPath: string | null) {
  return useQuery({
    queryKey: ["stashList", repoPath],
    queryFn: () => stashList(repoPath!),
    enabled: repoPath !== null,
    staleTime: 0,
  });
}

export function useStashShow(repoPath: string | null, index: number | null) {
  return useQuery({
    queryKey: ["stashShow", repoPath, index],
    queryFn: () => stashShow(repoPath!, index!),
    enabled: repoPath !== null && index !== null,
  });
}

// ── Actions (GitHub Actions) ────────────────────────────────────────────────

export function useWorkflowRuns(
  repoPath: string | null,
  accountId: string | null,
  options?: { polling?: boolean },
) {
  const polling = options?.polling ?? false;
  return useQuery({
    queryKey: ["workflowRuns", repoPath, accountId],
    queryFn: () => listWorkflowRuns(repoPath!, accountId!),
    enabled: repoPath !== null && accountId !== null,
    refetchInterval: polling ? 30_000 : false,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
  });
}

export function useWorkflowRunJobs(
  repoPath: string | null,
  accountId: string | null,
  runId: number | null,
) {
  return useQuery({
    queryKey: ["workflowRunJobs", repoPath, accountId, runId],
    queryFn: () => getWorkflowRunJobs(repoPath!, accountId!, runId!),
    enabled: repoPath !== null && accountId !== null && runId !== null,
  });
}

// ── Stash Mutations ─────────────────────────────────────────────────────────

/** "merge" | "rebase" | null — the git operation currently in progress. */
export function useMergeState(repoPath: string | null) {
  return useQuery({
    queryKey: ["mergeState", repoPath],
    queryFn: () => getMergeState(repoPath!),
    enabled: repoPath !== null,
    staleTime: 0,
  });
}

export function useMergeRecoveryMutations(repoPath: string | null) {
  const queryClient = useQueryClient();

  const invalidateAll = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["status"] }),
      queryClient.invalidateQueries({ queryKey: ["mergeState"] }),
      queryClient.invalidateQueries({ queryKey: ["branches"] }),
      queryClient.invalidateQueries({ queryKey: ["commitHistory"] }),
    ]);

  const abort = useMutation({
    mutationFn: () => abortMergeOrRebase(repoPath!),
    onSuccess: invalidateAll,
  });

  const conclude = useMutation({
    mutationFn: () => continueMergeOrRebase(repoPath!),
    onSuccess: invalidateAll,
  });

  return { abort, conclude };
}

export function useStashMutations(repoPath: string | null) {
  const queryClient = useQueryClient();

  const invalidateStashAndStatus = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["stashList"] }),
      queryClient.invalidateQueries({ queryKey: ["status"] }),
    ]);

  const applyMutation = useMutation({
    mutationFn: (index: number) => stashApply(repoPath!, index),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["status"] }),
  });

  const popMutation = useMutation({
    mutationFn: () => stashPop(repoPath!),
    onSuccess: () => invalidateStashAndStatus(),
  });

  const dropMutation = useMutation({
    mutationFn: (index: number) => stashDrop(repoPath!, index),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["stashList"] }),
  });

  const pushMutation = useMutation({
    mutationFn: (message?: string) => stashPush(repoPath!, message),
    onSuccess: () => invalidateStashAndStatus(),
  });

  const pushPartialMutation = useMutation({
    mutationFn: ({ paths, message }: { paths: string[]; message?: string }) =>
      stashPushPartial(repoPath!, paths, message),
    onSuccess: () => invalidateStashAndStatus(),
  });

  return {
    apply: applyMutation,
    pop: popMutation,
    drop: dropMutation,
    push: pushMutation,
    pushPartial: pushPartialMutation,
  };
}

// ── Verification (verify subsystem) ─────────────────────────────────────────

import {
  verifyWorkingTree,
  verifyCommit,
  verifyCommitRange,
  getVerifyRules,
  setVerifyRuleEnabled,
  checkDependencies,
  getFileReviewStates,
  markFileReviewed,
  unmarkFileReviewed,
  getCommitReviewStates,
  markCommitReviewed,
  unmarkCommitReviewed,
  getReviewQueue,
  getPushGateSummary,
  getLedgerEnabled,
  setLedgerEnabled,
  readEvidenceLedger,
  recordEvidenceLedger,
  listSessionsForRepo,
  getSessionSummary,
  verifySession,
  correlateSessionsToCommits,
  getSessionCumulativeDiff,
  getTestEvidence,
  runTestCommand,
  getDiffCoverage,
  getStructuralDiff,
  verifySyntax,
  buildSymbolIndex,
  cancelSymbolIndex,
  getSymbolIndexStatus,
  getHookStatus,
  previewHookInstall,
  installVerifyHooks,
  uninstallVerifyHooks,
  listHookSessions,
} from "./verify";

/**
 * Query key roots for everything a rule toggle invalidates. Turning a rule on
 * or off changes every report, including the ones already cached.
 */
const VERIFY_REPORT_KEYS = [
  "verifyWorkingTree",
  "verifyCommit",
  "verifyCommitRange",
  "verifyDependencies",
  "verifySession",
  "verifySyntax",
  "pushGateSummary",
];

/**
 * V2·V3·V5·V6·V10 over the working tree. `draftMessage` is the commit message
 * being typed, which V6 compares the changed paths against.
 *
 * Tree-derived, so it is never cached as fresh; `useRepoWatcher` invalidates
 * `["verifyWorkingTree"]` when files change.
 */
export function useVerificationReport(
  repoPath: string | null,
  staged: boolean,
  draftMessage: string | null = null,
) {
  return useQuery({
    queryKey: ["verifyWorkingTree", repoPath, staged, draftMessage],
    queryFn: () => verifyWorkingTree(repoPath!, staged, draftMessage),
    enabled: repoPath !== null,
    staleTime: 0,
  });
}

/** Full per-commit report. V32 walks later history, so new commits can change it. */
export function useCommitVerification(repoPath: string | null, oid: string | null) {
  return useQuery({
    queryKey: ["verifyCommit", repoPath, oid],
    queryFn: () => verifyCommit(repoPath!, oid!),
    enabled: repoPath !== null && oid !== null,
    staleTime: 60_000,
  });
}

/**
 * Badge summaries for a page of history rows. The backend caps the batch at
 * 100 commits and drops unreadable ones rather than failing the whole call.
 */
export function useCommitVerificationSummaries(repoPath: string | null, oids: string[]) {
  return useQuery({
    queryKey: ["verifyCommitRange", repoPath, oids],
    queryFn: () => verifyCommitRange(repoPath!, oids),
    enabled: repoPath !== null && oids.length > 0,
    staleTime: 60_000,
  });
}

/** Every registry rule including the planned ones, with the user's on/off state. */
export function useVerifyRules() {
  return useQuery({
    queryKey: ["verifyRules"],
    queryFn: getVerifyRules,
  });
}

/**
 * V4. Gated behind `enabled` because `allowRegistry` reaches the network —
 * it must never run just because a panel mounted.
 */
export function useDependencyCheck(
  repoPath: string | null,
  oid: string | null,
  allowRegistry: boolean,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["verifyDependencies", repoPath, oid, allowRegistry],
    queryFn: () => checkDependencies(repoPath!, oid, allowRegistry),
    enabled: repoPath !== null && enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

// V13 · V29 — review state

/** V13. Never cached as fresh: a file that changed goes back to `stale` on read. */
export function useFileReviewStates(
  repoPath: string | null,
  paths: string[],
  staged: boolean,
) {
  return useQuery({
    queryKey: ["fileReviewStates", repoPath, paths, staged],
    queryFn: () => getFileReviewStates(repoPath!, paths, staged),
    enabled: repoPath !== null && paths.length > 0,
    staleTime: 0,
  });
}

export function useCommitReviewStates(repoPath: string | null, oids: string[]) {
  return useQuery({
    queryKey: ["commitReviewStates", repoPath, oids],
    queryFn: () => getCommitReviewStates(repoPath!, oids),
    enabled: repoPath !== null && oids.length > 0,
    staleTime: 0,
  });
}

/** V29 — commits added since the last review, newest first. */
export function useReviewQueue(repoPath: string | null, limit: number | null = null) {
  return useQuery({
    queryKey: ["reviewQueue", repoPath, limit],
    queryFn: () => getReviewQueue(repoPath!, limit),
    enabled: repoPath !== null,
    staleTime: 0,
  });
}

/**
 * V34. Gated behind `enabled` so the walk only runs when the gate is opened.
 * The result is display-only — never use it to disable a push control.
 */
export function usePushGateSummary(
  repoPath: string | null,
  remote: string | null,
  branch: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["pushGateSummary", repoPath, remote, branch],
    queryFn: () => getPushGateSummary(repoPath!, remote!, branch!),
    enabled: repoPath !== null && remote !== null && branch !== null && enabled,
    staleTime: 0,
    retry: false,
  });
}

// V33 — evidence ledger

export function useLedgerEnabled(repoPath: string | null) {
  return useQuery({
    queryKey: ["ledgerEnabled", repoPath],
    queryFn: () => getLedgerEnabled(repoPath!),
    enabled: repoPath !== null,
    staleTime: 5 * 60 * 1000,
  });
}

export function useEvidenceLedger(repoPath: string | null, oid: string | null) {
  return useQuery({
    queryKey: ["evidenceLedger", repoPath, oid],
    queryFn: () => readEvidenceLedger(repoPath!, oid!),
    enabled: repoPath !== null && oid !== null,
  });
}

// V19~V27 · V30 — session logs
//
// Parsing a session log is expensive and may legitimately return nothing, so
// these hooks cache for a while and never retry. An absent log is not an error.

export function useSessionList(repoPath: string | null, limit: number | null = null) {
  return useQuery({
    queryKey: ["sessionList", repoPath, limit],
    queryFn: () => listSessionsForRepo(repoPath!, limit),
    enabled: repoPath !== null,
    staleTime: 30_000,
    retry: false,
  });
}

export function useSessionSummary(sessionPath: string | null) {
  return useQuery({
    queryKey: ["sessionSummary", sessionPath],
    queryFn: () => getSessionSummary(sessionPath!),
    enabled: sessionPath !== null,
    staleTime: 30_000,
    retry: false,
  });
}

export function useSessionVerification(repoPath: string | null, sessionPath: string | null) {
  return useQuery({
    queryKey: ["verifySession", repoPath, sessionPath],
    queryFn: () => verifySession(repoPath!, sessionPath!),
    enabled: repoPath !== null && sessionPath !== null,
    staleTime: 30_000,
    retry: false,
  });
}

/** V30. Every link carries a `confidence`; `low` must render as an estimate. */
export function useSessionCommitLinks(repoPath: string | null, oids: string[]) {
  return useQuery({
    queryKey: ["sessionCommitLinks", repoPath, oids],
    queryFn: () => correlateSessionsToCommits(repoPath!, oids),
    enabled: repoPath !== null && oids.length > 0,
    staleTime: 30_000,
    retry: false,
  });
}

/** V30 — the session's net change. Gated: it walks up to 200 commits. */
export function useSessionCumulativeDiff(
  repoPath: string | null,
  sessionPath: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["sessionCumulativeDiff", repoPath, sessionPath],
    queryFn: () => getSessionCumulativeDiff(repoPath!, sessionPath!),
    enabled: repoPath !== null && sessionPath !== null && enabled,
    staleTime: 30_000,
    retry: false,
  });
}

// V11 · V12 — execution evidence

/** Freshness is computed against the tree as it is right now, so never cache it. */
export function useTestEvidence(repoPath: string | null) {
  return useQuery({
    queryKey: ["testEvidence", repoPath],
    queryFn: () => getTestEvidence(repoPath!),
    enabled: repoPath !== null,
    staleTime: 0,
  });
}

/**
 * V12. A missing report is not an error: every changed file lands in
 * `unmappedFiles`, which the UI must render as "unknown", never as "covered".
 */
export function useDiffCoverage(
  repoPath: string | null,
  oid: string | null = null,
  coveragePath: string | null = null,
) {
  return useQuery({
    queryKey: ["diffCoverage", repoPath, oid, coveragePath],
    queryFn: () => getDiffCoverage(repoPath!, oid, coveragePath),
    enabled: repoPath !== null,
    staleTime: 0,
  });
}

// V1 · V7 · V8 · V9 · V17 — tree-sitter scans and the symbol index

/**
 * V1 for one open file. Cheap enough to run per file (one parse of each side),
 * and the answer only changes when the file's content does — so it is cached
 * with the same lifetime as the diff it annotates.
 */
export function useStructuralDiff(
  repoPath: string | null,
  oid: string | null,
  path: string | null,
  staged: boolean,
) {
  return useQuery({
    queryKey: ["structuralDiff", repoPath, oid, path, staged],
    queryFn: () => getStructuralDiff(repoPath!, oid, path!, staged),
    enabled: repoPath !== null && path !== null && path !== "",
    staleTime: 60_000,
    // A file outside the language scope is answered, not thrown; a real
    // rejection means the scan is unavailable, and retrying will not help.
    retry: false,
  });
}

/**
 * V1 · V7 · V8 · V9 · V17 in one scan. **Disabled by default on purpose** —
 * it parses every changed file, so arrow-keying through history must not
 * trigger it. Call `refetch()` from an explicit button; `isFetching` is the
 * running state.
 *
 * The returned report carries its own complete `checked`/`unchecked`
 * accounting. Render it as its own report — do not add its counts to another.
 */
export function useSyntaxVerification(
  repoPath: string | null,
  oid: string | null,
  staged: boolean,
) {
  return useQuery({
    queryKey: ["verifySyntax", repoPath, oid, staged],
    queryFn: () => verifySyntax(repoPath!, oid, staged),
    enabled: false,
    staleTime: 60_000,
    retry: false,
  });
}

/**
 * Symbol index state. Polls only while a build is running — the backend has no
 * "idle" push, and polling a finished index would be a timer for nothing.
 */
export function useSymbolIndexStatus(repoPath: string | null) {
  return useQuery({
    queryKey: ["symbolIndexStatus", repoPath],
    queryFn: () => getSymbolIndexStatus(repoPath!),
    enabled: repoPath !== null,
    refetchInterval: (query) => (query.state.data?.state === "building" ? 1000 : false),
    staleTime: 0,
  });
}

// V28 — Claude Code hooks

/** A probe. Never throws for a missing settings file; that is `settingsState`. */
export function useHookStatus() {
  return useQuery({
    queryKey: ["hookStatus"],
    queryFn: getHookStatus,
    staleTime: 30_000,
  });
}

/**
 * Sessions from the hook event log. Empty when the hook is not installed, which
 * is the normal case — callers merge this with the session-file list.
 */
export function useHookSessions(repoPath: string | null) {
  return useQuery({
    queryKey: ["hookSessions", repoPath],
    queryFn: () => listHookSessions(repoPath),
    enabled: repoPath !== null,
    staleTime: 30_000,
  });
}

// ── Verification mutations ──────────────────────────────────────────────────

/** Toggling a rule changes every report, so all of them are invalidated. */
export function useVerifyRuleMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ ruleId, enabled }: { ruleId: string; enabled: boolean }) =>
      setVerifyRuleEnabled(ruleId, enabled),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["verifyRules"] }),
        ...VERIFY_REPORT_KEYS.map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      ]),
  });
}

/** V13 — mark/unmark a file. The backend derives the diff hash from `path`. */
export function useFileReviewMutations(repoPath: string | null) {
  const queryClient = useQueryClient();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["fileReviewStates"] });

  const mark = useMutation({
    mutationFn: ({ path, staged }: { path: string; staged: boolean }) =>
      markFileReviewed(repoPath!, path, staged),
    onSuccess: invalidate,
  });

  const unmark = useMutation({
    mutationFn: (path: string) => unmarkFileReviewed(repoPath!, path),
    onSuccess: invalidate,
  });

  return { mark, unmark };
}

/** V29 — marking a commit also moves the unreviewed queue and the push gate. */
export function useCommitReviewMutations(repoPath: string | null) {
  const queryClient = useQueryClient();

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["commitReviewStates"] }),
      queryClient.invalidateQueries({ queryKey: ["reviewQueue"] }),
      queryClient.invalidateQueries({ queryKey: ["pushGateSummary"] }),
    ]);

  const mark = useMutation({
    mutationFn: (oid: string) => markCommitReviewed(repoPath!, oid),
    onSuccess: invalidate,
  });

  const unmark = useMutation({
    mutationFn: (oid: string) => unmarkCommitReviewed(repoPath!, oid),
    onSuccess: invalidate,
  });

  return { mark, unmark };
}

/** V33 — the ledger is local-only and off by default; nothing here ever pushes. */
export function useLedgerMutations(repoPath: string | null) {
  const queryClient = useQueryClient();

  const setEnabled = useMutation({
    mutationFn: (enabled: boolean) => setLedgerEnabled(repoPath!, enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ledgerEnabled"] }),
  });

  const record = useMutation({
    mutationFn: (oid: string) => recordEvidenceLedger(repoPath!, oid),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["evidenceLedger"] }),
  });

  return { setEnabled, record };
}

/**
 * Building the symbol index is always a user action — never started on mount.
 * `build` returns as soon as the slot is claimed; the rest arrives on the
 * `verify:index-progress` event (see `useSymbolIndex`).
 */
export function useSymbolIndexMutations(repoPath: string | null) {
  const queryClient = useQueryClient();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["symbolIndexStatus", repoPath] });

  const build = useMutation({
    mutationFn: () => buildSymbolIndex(repoPath!),
    onSuccess: invalidate,
  });

  const cancel = useMutation({
    mutationFn: () => cancelSymbolIndex(repoPath!),
    onSuccess: invalidate,
  });

  return { build, cancel };
}

/**
 * V28 — install/uninstall write to `~/.claude/settings.json`. Both are reachable
 * only from an explicit confirmation; nothing here runs on mount.
 *
 * A fresh install changes which sessions exist, so the session lists refresh too.
 */
export function useHookMutations() {
  const queryClient = useQueryClient();

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["hookStatus"] }),
      queryClient.invalidateQueries({ queryKey: ["hookSessions"] }),
    ]);

  const install = useMutation({
    mutationFn: installVerifyHooks,
    onSuccess: invalidate,
  });

  const uninstall = useMutation({
    mutationFn: uninstallVerifyHooks,
    onSuccess: invalidate,
  });

  /** Read-only: fetches the exact bytes the dialog must show before consent. */
  const preview = useMutation({
    mutationFn: previewHookInstall,
  });

  return { preview, install, uninstall };
}

/**
 * V11 — a failing suite resolves successfully with `passed: false`, so treat a
 * rejection as "the run could not start", not as "the tests failed".
 */
export function useTestRunMutation(repoPath: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (command: string) => runTestCommand(repoPath!, command),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["testEvidence"] }),
        queryClient.invalidateQueries({ queryKey: ["verifyWorkingTree"] }),
      ]),
  });
}

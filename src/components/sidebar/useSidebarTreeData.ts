import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRepoSyncStatuses } from "@/api/queries";
import { useReviewStatus, type WorktreeReviewStatus } from "@/hooks/useReviewStatus";
import { buildRepoTree, type AccountNode, type PathSignals, type WorktreeInput } from "@/lib/repo-tree";
import { useAccountStore } from "@/stores/account";
import { useActivityTargetsStore } from "@/stores/activity-targets";
import { useLiveChangesStore } from "@/stores/live-changes";
import { useRepositoryStore } from "@/stores/repository";
import { useWorkspaceStore } from "@/stores/workspace";
import type { RepoReviewStatus, RepoSyncStatus } from "@/types";
import { buildSignals, worktreesByRepoFrom } from "./tree-model";

/** 사이드바가 활동 감시 대상에 경로를 더할 때 쓰는 키. */
export const SIDEBAR_WATCH_KEY = "sidebar";

/** 「지금 바뀌는 곳」과 조용한 저장소 판정이 시간이 지나면 풀리도록 다시 그리는 간격. */
const NOW_TICK_MS = 15_000;

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

const EMPTY_SYNC: Record<string, RepoSyncStatus> = {};

export interface SidebarTreeData {
  tree: AccountNode[];
  signals: Record<string, PathSignals>;
  syncByPath: Record<string, RepoSyncStatus>;
  reviewByPath: Record<string, WorktreeReviewStatus>;
  reviewRepos: RepoReviewStatus[];
  worktreesByRepo: Record<string, WorktreeInput[]>;
  lastChangedAt: Record<string, number>;
  /** 백엔드가 실시간 감시 중인 경로(`repo:activity`가 오는 곳). */
  watched: string[];
  /** 실시간 감시 상한(40곳)을 넘겨 20초 폴링으로만 채우는 경로. */
  overflow: string[];
  now: number;
  /** 경로(저장소·워크트리)의 지금 브랜치. 모르면 null. */
  branchOf: (path: string) => string | null;
}

/**
 * 사이드바 트리가 쓰는 데이터를 한곳에서 모은다.
 *
 * - 워크트리 목록과 새 커밋 수: `review_status` + `count_new_commits`(`useReviewStatus`, 20초).
 * - 커밋하지 않은 파일 수와 ↑↓: 저장소와 링크된 워크트리 경로 전체를 `repo_sync_status` 한 번의
 *   묶음 호출로 읽는다(20초). 저장소가 늘어도 호출 수는 늘지 않는다.
 * - 파일 변경 시각: `live-changes` 스토어.
 *
 * 감시 대상 등록은 화면의 펼침 상태(검색, 조용한 저장소 줄)를 아는 `RepoTree`가
 * `useSidebarWatchPaths`로 한다.
 */
export function useSidebarTreeData(): SidebarTreeData {
  const repos = useRepositoryStore((s) => s.repos);
  const accounts = useAccountStore((s) => s.accounts);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const orderByParent = useWorkspaceStore((s) => s.orderByParent);
  const sortModeByAccount = useWorkspaceStore((s) => s.sortModeByAccount);
  const lastChangedAt = useLiveChangesStore((s) => s.lastChangedAt);
  const overflow = useLiveChangesStore((s) => s.overflow);
  const watched = useLiveChangesStore((s) => s.watched);
  const now = useNow(NOW_TICK_MS);

  const repoPathList = useMemo(() => repos.map((r) => r.path), [repos]);
  const review = useReviewStatus(repoPathList);
  const worktreesByRepo = useMemo(() => worktreesByRepoFrom(review.repos), [review.repos]);

  const statusPaths = useMemo(
    () => [...repoPathList, ...Object.values(worktreesByRepo).flatMap((wts) => wts.map((w) => w.path))],
    [repoPathList, worktreesByRepo],
  );
  const { data: syncData } = useRepoSyncStatuses(statusPaths);
  // 워크트리 목록이 바뀌면 조회 키가 바뀌어 잠깐 결과가 비는데, 그동안 앞 결과를 보여 줘
  // 표시가 깜박이지 않게 한다.
  const lastSync = useRef<Record<string, RepoSyncStatus>>(EMPTY_SYNC);
  if (syncData) lastSync.current = syncData;
  const syncByPath = syncData ?? lastSync.current;

  const signals = useMemo(
    () => buildSignals(syncByPath, review.byPath, lastChangedAt),
    [syncByPath, review.byPath, lastChangedAt],
  );

  const tree = useMemo(
    () =>
      buildRepoTree({
        repos,
        accounts,
        workspaces,
        orderByParent,
        sortModeByAccount,
        signals,
        worktreesByRepo,
        now,
      }),
    [repos, accounts, workspaces, orderByParent, sortModeByAccount, signals, worktreesByRepo, now],
  );

  const reviewByPath = review.byPath;
  const branchOf = useCallback(
    (path: string) => syncByPath[path]?.branch || reviewByPath[path]?.branch || null,
    [syncByPath, reviewByPath],
  );

  return {
    tree,
    signals,
    syncByPath,
    reviewByPath,
    reviewRepos: review.repos,
    worktreesByRepo,
    lastChangedAt,
    watched,
    overflow,
    now,
    branchOf,
  };
}

/**
 * 화면에 워크트리 행이 보이는 경로를 활동 감시 대상(`sidebar` 키)으로 등록하고, 목록이 바뀌면
 * 덮어쓴다. 사이드바 트리가 사라지면(접힌 줄로 바뀌거나 화면이 닫히면) 등록을 지운다.
 */
export function useSidebarWatchPaths(paths: string[]): void {
  const registerWatchPaths = useActivityTargetsStore((s) => s.registerWatchPaths);
  const unregisterWatchPaths = useActivityTargetsStore((s) => s.unregisterWatchPaths);
  const key = paths.join("\u0000");
  useEffect(() => {
    registerWatchPaths(SIDEBAR_WATCH_KEY, paths);
    // key가 내용을 대신 비교한다(트리가 15초마다 새로 만들어져도 같은 목록이면 다시 등록하지 않는다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, registerWatchPaths]);
  useEffect(() => () => unregisterWatchPaths(SIDEBAR_WATCH_KEY), [unregisterWatchPaths]);
}

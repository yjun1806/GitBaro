import { LIVE_CHANGE_STALE_MS } from "@/stores/live-changes";
import {
  repoNodeKey,
  workspaceNodeKey,
  type AccountNode,
  type PathSignals,
  type RepoNode,
  type WorkspaceNode,
  type WorktreeInput,
} from "@/lib/repo-tree";
import type { WorktreeReviewStatus } from "@/hooks/useReviewStatus";
import type { RepoInfo, RepoReviewStatus, RepoSyncStatus } from "@/types";

/**
 * 사이드바 트리 화면에 쓰는 순수 계산. 트리 모양 자체는 `buildRepoTree`
 * (`src/lib/repo-tree.ts`)가 만들고, 여기서는 오른쪽 표시 값과 검색·「지금 바뀌는 곳」을 다룬다.
 */

/** 경로별 오른쪽 표시 값을 합친다. 동기화 상태·새 커밋·파일 변경 시각 중 하나라도 있는 경로만 담는다. */
export function buildSignals(
  syncByPath: Record<string, RepoSyncStatus>,
  reviewByPath: Record<string, WorktreeReviewStatus>,
  lastChangedAt: Record<string, number>,
): Record<string, PathSignals> {
  const paths = new Set([
    ...Object.keys(syncByPath),
    ...Object.keys(reviewByPath),
    ...Object.keys(lastChangedAt),
  ]);
  const out: Record<string, PathSignals> = {};
  for (const path of paths) {
    const sync = syncByPath[path];
    out[path] = {
      dirtyCount: sync?.dirtyCount ?? 0,
      newCommits: reviewByPath[path]?.newCount ?? 0,
      ahead: sync?.ahead ?? 0,
      behind: sync?.behind ?? 0,
      lastChangedAt: lastChangedAt[path] ?? null,
    };
  }
  return out;
}

/** 저장소별 링크된 워크트리(메인 작업 트리 제외). `review_status` 응답에서 만든다. */
export function worktreesByRepoFrom(repos: RepoReviewStatus[]): Record<string, WorktreeInput[]> {
  return Object.fromEntries(
    repos.map((r) => [
      r.repoPath,
      r.worktrees.filter((w) => !w.isMain).map((w) => ({ path: w.path, branch: w.branch })),
    ]),
  );
}

/**
 * 동기화 상태(`repo_sync_status`)를 물을 경로: 등록된 저장소와 그 링크된 워크트리.
 * 사이드바와 커밋 그래프가 같은 목록으로 물어 같은 조회(20초 폴링)를 함께 쓴다.
 */
export function syncStatusPaths(repoPaths: string[], repos: RepoReviewStatus[]): string[] {
  const worktrees = worktreesByRepoFrom(repos);
  return [...repoPaths, ...Object.values(worktrees).flatMap((wts) => wts.map((w) => w.path))];
}

export interface Totals {
  dirty: number;
  newCommits: number;
}

const ZERO: Totals = { dirty: 0, newCommits: 0 };

function add(a: Totals, s: PathSignals | undefined): Totals {
  return {
    dirty: a.dirty + (s?.dirtyCount ?? 0),
    newCommits: a.newCommits + (s?.newCommits ?? 0),
  };
}

export function repoPaths(node: RepoNode): string[] {
  return [node.repo.path, ...node.worktrees.map((w) => w.path)];
}

/** 저장소 행의 합계: 메인 작업 트리와 링크된 워크트리의 커밋하지 않은 파일·새 커밋을 더한다. */
export function repoTotals(node: RepoNode, signals: Record<string, PathSignals>): Totals {
  return repoPaths(node).reduce((acc, p) => add(acc, signals[p]), ZERO);
}

/** 워크스페이스 행의 합계: 안에 든 저장소 합계를 더한다. */
export function workspaceTotals(node: WorkspaceNode, signals: Record<string, PathSignals>): Totals {
  return node.repos.reduce((acc, r) => {
    const t = repoTotals(r, signals);
    return { dirty: acc.dirty + t.dirty, newCommits: acc.newCommits + t.newCommits };
  }, ZERO);
}

/** 경로 중 하나라도 10분 안에 파일이 바뀌었는지. */
export function isLivePath(
  path: string,
  lastChangedAt: Record<string, number>,
  now: number,
): boolean {
  const at = lastChangedAt[path];
  return typeof at === "number" && now - at <= LIVE_CHANGE_STALE_MS;
}

/**
 * 검색어로 트리를 거른다. 저장소 이름, 저장소의 현재 브랜치, 워크트리 브랜치 중 하나에
 * 검색어가 들어 있으면 남긴다. 워크스페이스는 이름이 맞으면 통째로, 아니면 맞는 저장소만 남긴다.
 * 검색하는 동안에는 조용한 저장소도 찾아야 하므로 맞는 것은 계정 바로 아래로 올린다.
 * 입력 트리는 바꾸지 않는다.
 */
export function filterTree(
  tree: AccountNode[],
  query: string,
  branchOf: (path: string) => string | null,
): AccountNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return tree;
  const hit = (s: string | null | undefined) => !!s && s.toLowerCase().includes(q);
  const repoMatches = (node: RepoNode) =>
    hit(node.repo.name) ||
    hit(branchOf(node.repo.path)) ||
    node.worktrees.some((w) => hit(w.branch));

  return tree.flatMap((account): AccountNode[] => {
    const children = account.children.flatMap((child): (WorkspaceNode | RepoNode)[] => {
      if (child.kind === "repo") return repoMatches(child) ? [child] : [];
      if (hit(child.workspace.name)) return [child];
      const repos = child.repos.filter(repoMatches);
      return repos.length > 0 ? [{ ...child, repos }] : [];
    });
    const quiet = account.quietRepos.filter(repoMatches);
    const all = [...children, ...quiet];
    return all.length > 0 ? [{ ...account, children: all, quietRepos: [] }] : [];
  });
}

/**
 * 「모두 접기」가 접는 키: 계정 머리글, 워크스페이스, 워크트리가 있는 저장소.
 * 「지금 바뀌는 곳」 칸의 키는 화면(`RepoTree`)이 따로 더한다.
 */
export function collapsibleKeys(tree: AccountNode[]): string[] {
  const keys: string[] = [];
  const repoKey = (r: RepoNode) => {
    if (r.worktrees.length > 0) keys.push(repoNodeKey(r.repo.path));
  };
  for (const account of tree) {
    keys.push(account.key);
    for (const child of account.children) {
      if (child.kind === "repo") repoKey(child);
      else {
        keys.push(workspaceNodeKey(child.workspace.id));
        child.repos.forEach(repoKey);
      }
    }
    account.quietRepos.forEach(repoKey);
  }
  return keys;
}

export interface LiveEntry {
  path: string;
  repo: RepoInfo;
  /** 링크된 워크트리의 변경이면 true. */
  isWorktree: boolean;
  branch: string | null;
  at: number;
}

/**
 * 「지금 바뀌는 곳」 목록. 10분 안에 바뀐 경로를 최근 순으로, 저장소 목록에 있는 저장소나 그 링크된
 * 워크트리로 풀어낸다. 어느 쪽도 아닌 경로(목록에서 빠진 저장소 등)는 뺀다.
 */
export function liveEntries(
  lastChangedAt: Record<string, number>,
  now: number,
  repos: RepoInfo[],
  worktreesByRepo: Record<string, WorktreeInput[]>,
  branchOf: (path: string) => string | null,
): LiveEntry[] {
  const repoByPath = new Map(repos.map((r) => [r.path, r]));
  const ownerByWorktree = new Map<string, RepoInfo>();
  for (const repo of repos) {
    for (const wt of worktreesByRepo[repo.path] ?? []) ownerByWorktree.set(wt.path, repo);
  }
  return Object.entries(lastChangedAt)
    .filter(([, at]) => now - at <= LIVE_CHANGE_STALE_MS)
    .sort((a, b) => b[1] - a[1])
    .flatMap(([path, at]): LiveEntry[] => {
      const own = repoByPath.get(path);
      if (own) return [{ path, repo: own, isWorktree: false, branch: branchOf(path), at }];
      const owner = ownerByWorktree.get(path);
      if (owner) return [{ path, repo: owner, isWorktree: true, branch: branchOf(path), at }];
      return [];
    });
}

/**
 * 화면에 워크트리 행이 보이는 저장소의 링크된 워크트리 경로. 활동 감시 대상에 더한다.
 *
 * `tree`는 화면에 그리는 트리(검색으로 거른 뒤)를, `isOpen`은 화면이 쓰는 펼침 판정(검색 중이면
 * 모두 펼침)을 그대로 넘긴다. 조용한 저장소는 그 계정의 「조용한 저장소」 줄을 연 경우
 * (`openQuietAccounts`에 계정 키가 있을 때)에만 보이므로 그때만 센다.
 */
export function expandedWorktreePaths(
  tree: AccountNode[],
  isOpen: (key: string) => boolean,
  openQuietAccounts: readonly string[] = [],
): string[] {
  const out: string[] = [];
  const visit = (r: RepoNode) => {
    if (r.worktrees.length > 0 && isOpen(repoNodeKey(r.repo.path))) {
      out.push(...r.worktrees.map((w) => w.path));
    }
  };
  for (const account of tree) {
    if (!isOpen(account.key)) continue;
    for (const child of account.children) {
      if (child.kind === "repo") visit(child);
      else if (isOpen(workspaceNodeKey(child.workspace.id))) child.repos.forEach(visit);
    }
    if (openQuietAccounts.includes(account.accountKey)) account.quietRepos.forEach(visit);
  }
  return out;
}

/**
 * 경로가 실시간 감시(`repo:activity`) 중인지. 백엔드가 알려 준 감시 목록(`watched`)에 있으면 참,
 * 상한을 넘긴 목록(`overflow`)에 있거나 둘 다에 없으면(감시 대상에서 빠진 경로) 거짓이다.
 * 아직 백엔드 응답이 한 번도 오지 않아 두 목록이 모두 비어 있으면 참으로 본다.
 */
export function isWatchedPath(path: string, watched: readonly string[], overflow: readonly string[]): boolean {
  if (watched.includes(path)) return true;
  return watched.length === 0 && overflow.length === 0;
}

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
import type { RepoReviewStatus, RepoSyncStatus } from "@/types";

/**
 * 사이드바 트리 화면에 쓰는 순수 계산. 트리 모양 자체는 `buildRepoTree`
 * (`src/lib/repo-tree.ts`)가 만들고, 여기서는 오른쪽 표시 값과 검색, 접힘·감시 대상을 다룬다.
 */

/** 경로별 오른쪽 표시 값을 합친다. 동기화 상태·워크트리 목록·파일 변경 시각 중 하나라도 있는 경로만 담는다. */
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
      // 「올릴 커밋」은 원격에 없는 커밋이다(추적 브랜치가 없어도 센다).
      ahead: sync?.unpushed ?? 0,
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

export function repoPaths(node: RepoNode): string[] {
  return [node.repo.path, ...node.worktrees.map((w) => w.path)];
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
 * 검색어로 트리를 거른다. 저장소 폴더 이름·표시 이름(`nameOf`), 저장소의 현재 브랜치, 워크트리 브랜치 중 하나에
 * 검색어가 들어 있으면 남긴다. 워크스페이스는 이름이 맞으면 통째로, 아니면 맞는 저장소만 남긴다.
 * 검색하는 동안에는 조용한 저장소도 찾아야 하므로 맞는 것은 계정 바로 아래로 올린다.
 * 입력 트리는 바꾸지 않는다.
 */
export function filterTree(
  tree: AccountNode[],
  query: string,
  branchOf: (path: string) => string | null,
  nameOf: (repo: RepoNode["repo"]) => string = (repo) => repo.name,
): AccountNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return tree;
  const hit = (s: string | null | undefined) => !!s && s.toLowerCase().includes(q);
  const repoMatches = (node: RepoNode) =>
    hit(node.repo.name) ||
    hit(nameOf(node.repo)) ||
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
 * 워크스페이스 카드 안 저장소 줄의 펼침 키. 이 줄은 기본이 접힘이라, 트리의 다른 접힘(기본 펼침,
 * 워크스페이스 스토어 `collapsed`)과 따로 화면(`RepoTree`)이 연 것만 기억한다.
 */
export const workspaceRepoKey = (path: string) => `wsrepo:${path}`;

/**
 * 「모두 접기」가 접는 키: 계정 머리글, 워크스페이스 카드, 계정 바로 아래 저장소 카드(조용한 저장소 포함).
 * 워크스페이스 안 저장소 줄은 기본이 접힘이라 여기서 뺀다.
 */
export function collapsibleKeys(tree: AccountNode[]): string[] {
  const keys: string[] = [];
  const repoKey = (r: RepoNode) => {
    keys.push(repoNodeKey(r.repo.path));
  };
  for (const account of tree) {
    keys.push(account.key);
    for (const child of account.children) {
      if (child.kind === "repo") repoKey(child);
      else keys.push(workspaceNodeKey(child.workspace.id));
    }
    account.quietRepos.forEach(repoKey);
  }
  return keys;
}

/**
 * 화면에 워크트리 행이 보이는 저장소의 링크된 워크트리 경로. 활동 감시 대상에 더한다.
 *
 * `tree`는 화면에 그리는 트리(검색으로 거른 뒤)를, `isOpen`은 화면이 쓰는 펼침 판정(검색 중이면
 * 모두 펼침)을 그대로 넘긴다. 워크스페이스 안 저장소는 `workspaceRepoKey`로 묻는다. 조용한 저장소는 그 계정의 「조용한 저장소」 줄을 연 경우
 * (`openQuietAccounts`에 계정 키가 있을 때)에만 보이므로 그때만 센다.
 */
export function expandedWorktreePaths(
  tree: AccountNode[],
  isOpen: (key: string) => boolean,
  openQuietAccounts: readonly string[] = [],
): string[] {
  const out: string[] = [];
  const visit = (r: RepoNode, key: string) => {
    if (r.worktrees.length > 0 && isOpen(key)) {
      out.push(...r.worktrees.map((w) => w.path));
    }
  };
  const visitCard = (r: RepoNode) => visit(r, repoNodeKey(r.repo.path));
  for (const account of tree) {
    if (!isOpen(account.key)) continue;
    for (const child of account.children) {
      if (child.kind === "repo") visitCard(child);
      else if (isOpen(workspaceNodeKey(child.workspace.id))) {
        child.repos.forEach((r) => visit(r, workspaceRepoKey(r.repo.path)));
      }
    }
    if (openQuietAccounts.includes(account.accountKey)) account.quietRepos.forEach(visitCard);
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

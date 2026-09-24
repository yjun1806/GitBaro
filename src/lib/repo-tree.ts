import { groupReposByOwner } from "@/lib/group-repos";
import type { RepoInfo } from "@/types";

/**
 * 사이드바 트리(계정 → 워크스페이스 → 저장소 → 워크트리)를 만드는 순수 함수 모음.
 *
 * 트리는 계정과 앱 전용 워크스페이스로만 묶는다. 브랜치 이름으로 저장소를 묶는
 * 코드는 두지 않는다(README 「브랜치 묶음」 금지).
 */

/** 계정 머리글의 정렬 방식. custom은 사용자가 끌어서 정한 순서다. */
export type SortMode = "custom" | "name" | "recent" | "todo";

export const SORT_MODES: readonly SortMode[] = ["custom", "name", "recent", "todo"];

/** 앱 상태에만 저장하는 저장소 묶음. 한 계정 안에만 존재한다. */
export interface Workspace {
  id: string;
  name: string;
  accountKey: string;
  repoPaths: string[];
}

/** 트리 노드 키. 접힘 상태와 순서 저장에 함께 쓴다. */
export const accountNodeKey = (accountKey: string) => `acct:${accountKey}`;
export const workspaceNodeKey = (id: string) => `ws:${id}`;
export const repoNodeKey = (path: string) => `repo:${path}`;
export const worktreeNodeKey = (path: string) => `wt:${path}`;

/**
 * 경로별 오른쪽 표시 값. 값이 없는 필드는 0으로 본다.
 * 경로는 저장소 경로와 워크트리 경로 모두 쓸 수 있다.
 */
export interface PathSignals {
  /** 커밋하지 않은 파일 수 */
  dirtyCount?: number;
  /** 마지막 확인 뒤 들어온 새 커밋 수 */
  newCommits?: number;
  ahead?: number;
  behind?: number;
  /** 마지막 파일 변경 시각(epoch ms). 모르면 null */
  lastChangedAt?: number | null;
}

export interface WorktreeInput {
  path: string;
  branch: string | null;
}

export interface WorktreeNode {
  kind: "worktree";
  key: string;
  path: string;
  branch: string | null;
}

export interface RepoNode {
  kind: "repo";
  key: string;
  repo: RepoInfo;
  worktrees: WorktreeNode[];
}

export interface WorkspaceNode {
  kind: "workspace";
  key: string;
  workspace: Workspace;
  repos: RepoNode[];
}

export interface AccountNode {
  kind: "account";
  key: string;
  accountKey: string;
  sortMode: SortMode;
  /** 워크스페이스와, 워크스페이스에 넣지 않은 저장소 */
  children: (WorkspaceNode | RepoNode)[];
  /** 계정 바로 아래 저장소 중 조용한 저장소. 「조용한 저장소 N개」 행으로 접는다. */
  quietRepos: RepoNode[];
}

export interface BuildRepoTreeInput {
  repos: RepoInfo[];
  accounts: { id: string; username: string }[];
  workspaces: Workspace[];
  orderByParent: Record<string, string[]>;
  sortModeByAccount: Record<string, SortMode>;
  signals?: Record<string, PathSignals>;
  /** 저장소 경로별 링크된 워크트리 목록(메인 작업 트리 제외) */
  worktreesByRepo?: Record<string, WorktreeInput[]>;
  /** 조용한 저장소 판정 기준 시각. 테스트에서 고정한다. */
  now?: number;
}

/** 이 시간 안에 파일이 바뀐 저장소는 조용하지 않다(질문 2 기본값). */
export const QUIET_WINDOW_MS = 10 * 60 * 1000;

/**
 * 저장소 경로 → 계정 키. 계정 판별은 기존 그룹핑(`groupReposByOwner`)을 그대로 쓴다.
 * 그래서 계정 키는 지금 사이드바 그룹 이름(origin owner, 없으면 계정 username, 그것도
 * 없으면 "Local")과 같다.
 */
export function accountKeysByPath(
  repos: RepoInfo[],
  accounts: { id: string; username: string }[],
): Map<string, string> {
  const result = new Map<string, string>();
  for (const group of groupReposByOwner(repos, accounts)) {
    for (const repo of group.repos) {
      result.set(repo.path, group.label);
    }
  }
  return result;
}

function todoScore(s: PathSignals | undefined): number {
  if (!s) return 0;
  return (s.dirtyCount ?? 0) + (s.newCommits ?? 0) + (s.ahead ?? 0) + (s.behind ?? 0);
}

function repoPathsOf(node: RepoNode): string[] {
  return [node.repo.path, ...node.worktrees.map((w) => w.path)];
}

function nodePaths(node: WorkspaceNode | RepoNode): string[] {
  return node.kind === "repo" ? repoPathsOf(node) : node.repos.flatMap(repoPathsOf);
}

function nodeName(node: WorkspaceNode | RepoNode): string {
  return node.kind === "repo" ? node.repo.name : node.workspace.name;
}

function nodeTodo(node: WorkspaceNode | RepoNode, signals: Record<string, PathSignals>): number {
  return nodePaths(node).reduce((sum, p) => sum + todoScore(signals[p]), 0);
}

function nodeLastChanged(
  node: WorkspaceNode | RepoNode,
  signals: Record<string, PathSignals>,
): number | null {
  const times = nodePaths(node)
    .map((p) => signals[p]?.lastChangedAt)
    .filter((t): t is number => typeof t === "number");
  return times.length > 0 ? Math.max(...times) : null;
}

const byName = <T extends WorkspaceNode | RepoNode>(a: T, b: T) =>
  nodeName(a).localeCompare(nodeName(b), undefined, { sensitivity: "base" });

/**
 * 형제 노드를 정렬한다. 입력 배열은 바꾸지 않는다.
 * - custom: 저장된 순서가 먼저, 저장되지 않은 노드는 입력 순서대로 뒤에 붙는다.
 * - name: 이름순.
 * - recent: 마지막 파일 변경이 늦은 순. 기록이 없으면 뒤로, 그 안에서는 이름순.
 * - todo: 할 일(커밋하지 않은 파일·새 커밋·↑↓)이 있는 것 먼저, 각 무리 안에서는 이름순.
 */
export function sortSiblings<T extends WorkspaceNode | RepoNode>(
  nodes: T[],
  mode: SortMode,
  savedOrder: string[] | undefined,
  signals: Record<string, PathSignals>,
): T[] {
  switch (mode) {
    case "custom": {
      const rank = new Map((savedOrder ?? []).map((key, i) => [key, i]));
      const listed = nodes
        .filter((n) => rank.has(n.key))
        .sort((a, b) => rank.get(a.key)! - rank.get(b.key)!);
      const unlisted = nodes.filter((n) => !rank.has(n.key));
      return [...listed, ...unlisted];
    }
    case "name":
      return [...nodes].sort(byName);
    case "recent":
      return [...nodes].sort((a, b) => {
        const ta = nodeLastChanged(a, signals);
        const tb = nodeLastChanged(b, signals);
        if (ta !== tb) {
          if (ta === null) return 1;
          if (tb === null) return -1;
          return tb - ta;
        }
        return byName(a, b);
      });
    case "todo":
      return [...nodes].sort((a, b) => {
        const ha = nodeTodo(a, signals) > 0 ? 0 : 1;
        const hb = nodeTodo(b, signals) > 0 ? 0 : 1;
        return ha !== hb ? ha - hb : byName(a, b);
      });
  }
}

/**
 * 조용한 저장소: 저장소와 그 워크트리 모두 커밋하지 않은 파일·새 커밋·↑↓가 0이고,
 * 10분 안에 파일 변경이 없다. 신호를 아직 하나도 받지 못한 저장소는 조용하다고
 * 판단하지 않는다(모르는 것을 숨기지 않는다).
 */
export function isQuietRepo(
  node: RepoNode,
  signals: Record<string, PathSignals>,
  now: number,
): boolean {
  const paths = repoPathsOf(node);
  if (!paths.some((p) => signals[p] !== undefined)) return false;
  return paths.every((p) => {
    const s = signals[p];
    if (!s) return true;
    if (todoScore(s) > 0) return false;
    const at = s.lastChangedAt;
    return typeof at !== "number" || now - at > QUIET_WINDOW_MS;
  });
}

/**
 * 사이드바 트리를 만든다.
 * - 저장소 목록(`repos`)에 없는 경로는 워크스페이스에 남아 있어도 무시한다.
 * - 워크스페이스의 저장소라도 지금 계정이 워크스페이스 계정과 다르면(원격이 바뀐 경우)
 *   자기 계정 바로 아래에 둔다. 워크스페이스가 계정을 넘나들지 않게 하기 위해서다.
 * - 조용한 저장소는 계정 바로 아래 저장소에서만 따로 뺀다. 워크스페이스 안은 그대로 둔다.
 */
export function buildRepoTree(input: BuildRepoTreeInput): AccountNode[] {
  const {
    repos,
    accounts,
    workspaces,
    orderByParent,
    sortModeByAccount,
    signals = {},
    worktreesByRepo = {},
    now = Date.now(),
  } = input;

  const keyByPath = accountKeysByPath(repos, accounts);
  const repoByPath = new Map(repos.map((r) => [r.path, r]));

  const makeRepoNode = (repo: RepoInfo): RepoNode => ({
    kind: "repo",
    key: repoNodeKey(repo.path),
    repo,
    worktrees: (worktreesByRepo[repo.path] ?? []).map((w) => ({
      kind: "worktree",
      key: worktreeNodeKey(w.path),
      path: w.path,
      branch: w.branch,
    })),
  });

  // 계정 순서: 저장소에서 처음 나온 순서, 그 뒤에 저장소 없이 워크스페이스만 있는 계정.
  const accountKeys: string[] = [];
  for (const key of [...keyByPath.values(), ...workspaces.map((w) => w.accountKey)]) {
    if (!accountKeys.includes(key)) accountKeys.push(key);
  }

  const claimed = new Set<string>();
  const workspaceNodes = new Map<string, WorkspaceNode[]>();
  for (const ws of workspaces) {
    const memberRepos = ws.repoPaths
      .map((p) => repoByPath.get(p))
      .filter((r): r is RepoInfo => r !== undefined)
      .filter((r) => keyByPath.get(r.path) === ws.accountKey && !claimed.has(r.path));
    memberRepos.forEach((r) => claimed.add(r.path));
    const node: WorkspaceNode = {
      kind: "workspace",
      key: workspaceNodeKey(ws.id),
      workspace: ws,
      repos: memberRepos.map(makeRepoNode),
    };
    workspaceNodes.set(ws.accountKey, [...(workspaceNodes.get(ws.accountKey) ?? []), node]);
  }

  return accountKeys.map((accountKey) => {
    const sortMode = sortModeByAccount[accountKey] ?? "custom";
    const wsNodes = (workspaceNodes.get(accountKey) ?? []).map((ws) => ({
      ...ws,
      repos: sortSiblings(ws.repos, sortMode, orderByParent[ws.key], signals),
    }));
    const looseRepos = repos
      .filter((r) => keyByPath.get(r.path) === accountKey && !claimed.has(r.path))
      .map(makeRepoNode);
    const quietRepos = looseRepos.filter((n) => isQuietRepo(n, signals, now));
    const activeRepos = looseRepos.filter((n) => !quietRepos.includes(n));
    const key = accountNodeKey(accountKey);
    const order = orderByParent[key];
    return {
      kind: "account",
      key,
      accountKey,
      sortMode,
      children: sortSiblings<WorkspaceNode | RepoNode>(
        [...wsNodes, ...activeRepos],
        sortMode,
        order,
        signals,
      ),
      quietRepos: sortSiblings(quietRepos, sortMode, order, signals),
    };
  });
}

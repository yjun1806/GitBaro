import { extractOwnerFromRemoteUrl, groupReposByOwner } from "@/lib/group-repos";
import type { RepoInfo } from "@/types";

/**
 * 사이드바 트리(계정 → 워크스페이스 → 저장소 → 워크트리)를 만드는 순수 함수 모음.
 *
 * 트리는 계정과 앱 전용 워크스페이스로만 나눈다. 브랜치 이름으로 저장소를 모으는
 * 코드는 두지 않는다(README의 브랜치 기준 그룹 금지).
 */

/** 계정 머리글의 정렬 방식. custom은 사용자가 끌어서 정한 순서다. */
export type SortMode = "custom" | "name" | "recent" | "todo";

export const SORT_MODES: readonly SortMode[] = ["custom", "name", "recent", "todo"];

/**
 * 앱 상태에만 저장하는 폴더. 저장소 여러 개를 담고, 한 계정 안에만 존재한다.
 * `accountKey`는 `toAccountKey`로 만든 소문자 키다.
 */
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
  /** 비교·저장용 계정 키(소문자) */
  accountKey: string;
  /** 표시용 계정 이름(처음 나온 저장소의 origin 표기) */
  label: string;
  sortMode: SortMode;
  /**
   * 계정을 아직 모르는 저장소만 모인 임시 그룹(「Other」, `RepoAccount.pending`).
   * 키가 임시값이라 워크스페이스를 만들거나 정렬을 저장하는 자리로 쓰면 안 된다.
   */
  pending: boolean;
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
  /**
   * 지금 메인 칸에서 보고 있는 저장소(소유 저장소 경로, 워크트리를 보는 중이면 그 소유
   * 저장소). 조용하다고 판정돼도 이 저장소는 「조용한 저장소」 줄로 접지 않는다 — 접으면
   * 트리 어디에도 선택 표시가 없어진다(QuietReposRow는 선택 상태를 표시하지 않는다).
   */
  activeRepoPath?: string | null;
}

/** 이 시간 안에 파일이 바뀐 저장소는 조용하지 않다(질문 2 기본값). */
export const QUIET_WINDOW_MS = 10 * 60 * 1000;

/**
 * 계정 키. GitHub owner 이름은 대소문자를 가리지 않으므로(`YJun`과 `yjun`은 같은 계정)
 * 소문자로 맞춘다. 워크스페이스 `accountKey`, `sortModeByAccount`의 키, `acct:<키>` 노드
 * 키가 모두 이 값을 쓴다. 화면에는 `RepoAccount.label`(원래 표기)을 보여 준다.
 */
export const toAccountKey = (label: string): string => label.toLowerCase();

export interface RepoAccount {
  /** 비교·저장용 계정 키(소문자) */
  key: string;
  /** 표시용 이름. 기존 사이드바 그룹 이름과 같다. */
  label: string;
  /**
   * 계정을 아직 모른다: GitHub origin이 없고 `accountId`는 있는데, 그 계정이 계정 목록에
   * 없다(시작 직후 계정을 불러오기 전, 로그아웃 뒤). 이때 `key`는 임시값("other")이라
   * 규칙 판단에 쓰면 안 된다.
   */
  pending: boolean;
}

/**
 * 저장소 경로 → 계정. 계정 판별은 기존 그룹핑(`groupReposByOwner`)을 그대로 쓴다.
 * 그래서 `label`은 지금 사이드바 그룹 이름(origin owner, 없으면 계정 username, 그것도
 * 없으면 "Local")과 같고, `key`는 그 소문자다.
 */
export function repoAccountsByPath(
  repos: RepoInfo[],
  accounts: { id: string; username: string }[],
): Map<string, RepoAccount> {
  const knownIds = new Set(accounts.map((a) => a.id));
  const result = new Map<string, RepoAccount>();
  for (const group of groupReposByOwner(repos, accounts)) {
    for (const repo of group.repos) {
      const origin = repo.remotes.find((r) => r.name === "origin");
      const owner = origin ? extractOwnerFromRemoteUrl(origin.url) : null;
      const pending = owner === null && !!repo.accountId && !knownIds.has(repo.accountId);
      result.set(repo.path, { key: toAccountKey(group.label), label: group.label, pending });
    }
  }
  return result;
}

export interface WorkspaceMembership {
  /** 워크스페이스 id → 지금 그 워크스페이스에 드는 저장소(워크스페이스에 적힌 순서) */
  membersById: Map<string, RepoInfo[]>;
  /** 저장소 경로 → 그 저장소를 담은 워크스페이스의 계정 키 */
  claimedBy: Map<string, string>;
}

/**
 * 워크스페이스마다 지금 실제로 드는 저장소를 정한다. 사이드바(`buildRepoTree`)와 선택 범위
 * (`resolveActiveScope`)가 이 규칙 하나를 함께 쓴다.
 * - 저장소 목록(`repos`)에 없는 경로는 뺀다.
 * - 저장소의 지금 계정이 워크스페이스 계정과 다르면 뺀다(계정 지정이나 원격이 바뀐 경우).
 *   계정을 아직 모르는 저장소(`RepoAccount.pending`)는 저장된 소속을 믿고 둔다(모른다고
 *   빼면 계정 목록을 불러오기 전마다 워크스페이스가 빈다).
 * - 한 저장소는 앞선 워크스페이스 하나에만 든다.
 */
export function workspaceMembership(
  workspaces: Workspace[],
  repos: RepoInfo[],
  accountByPath: Map<string, RepoAccount>,
): WorkspaceMembership {
  const repoByPath = new Map(repos.map((r) => [r.path, r]));
  const claimedBy = new Map<string, string>();
  const membersById = new Map<string, RepoInfo[]>();
  for (const ws of workspaces) {
    const wsAccount = toAccountKey(ws.accountKey);
    const members = ws.repoPaths
      .map((p) => repoByPath.get(p))
      .filter((r): r is RepoInfo => r !== undefined)
      .filter((r) => {
        const acc = accountByPath.get(r.path);
        return !!acc && (acc.pending || acc.key === wsAccount) && !claimedBy.has(r.path);
      });
    members.forEach((r) => claimedBy.set(r.path, wsAccount));
    membersById.set(ws.id, members);
  }
  return { membersById, claimedBy };
}

function todoScore(s: PathSignals | undefined): number {
  if (!s) return 0;
  return (s.dirtyCount ?? 0) + (s.ahead ?? 0) + (s.behind ?? 0);
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
 * - todo: 할 일(커밋하지 않은 파일·↑↓)이 있는 것 먼저, 각 무리 안에서는 이름순.
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
 * 조용한 저장소: 저장소와 그 워크트리 모두 커밋하지 않은 파일·↑↓가 0이고,
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
 * - 계정은 대소문자를 가리지 않는다(`toAccountKey`).
 * - 워크스페이스의 저장소라도 지금 계정이 워크스페이스 계정과 다르면(원격이 바뀐 경우)
 *   자기 계정 바로 아래에 둔다. 워크스페이스가 계정을 넘나들지 않게 하기 위해서다.
 *   계정을 아직 모르는 저장소(`RepoAccount.pending`)는 저장된 소속을 그대로 따른다.
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
    activeRepoPath = null,
  } = input;

  const accountByPath = repoAccountsByPath(repos, accounts);

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

  const { membersById, claimedBy } = workspaceMembership(workspaces, repos, accountByPath);
  const workspaceNodes = new Map<string, WorkspaceNode[]>();
  for (const ws of workspaces) {
    const wsAccount = toAccountKey(ws.accountKey);
    const memberRepos = membersById.get(ws.id) ?? [];
    const node: WorkspaceNode = {
      kind: "workspace",
      key: workspaceNodeKey(ws.id),
      workspace: ws,
      repos: memberRepos.map(makeRepoNode),
    };
    workspaceNodes.set(wsAccount, [...(workspaceNodes.get(wsAccount) ?? []), node]);
  }

  // 계정 순서: 저장소에서 처음 나온 순서, 그 뒤에 저장소 없이 워크스페이스만 있는 계정.
  // 표시 이름은 그 계정에서 처음 나온 저장소의 표기를 쓴다.
  const accountKeys: string[] = [];
  const labels = new Map<string, string>();
  // 계정을 아는 저장소나 워크스페이스가 하나라도 있는 계정은 임시 그룹이 아니다.
  const settledKeys = new Set<string>(workspaceNodes.keys());
  for (const repo of repos) {
    const acc = accountByPath.get(repo.path);
    if (!acc) continue;
    const key = claimedBy.get(repo.path) ?? acc.key;
    if (!acc.pending) settledKeys.add(key);
    if (!accountKeys.includes(key)) accountKeys.push(key);
    // 워크스페이스로 계정이 정해진 저장소의 임시 이름("Other")은 쓰지 않는다.
    if (acc.key === key && !labels.has(key)) labels.set(key, acc.label);
  }
  for (const key of workspaceNodes.keys()) {
    if (!accountKeys.includes(key)) accountKeys.push(key);
  }

  return accountKeys.map((accountKey) => {
    const sortMode = sortModeByAccount[accountKey] ?? "custom";
    const wsNodes = (workspaceNodes.get(accountKey) ?? []).map((ws) => ({
      ...ws,
      repos: sortSiblings(ws.repos, sortMode, orderByParent[ws.key], signals),
    }));
    const looseRepos = repos
      .filter((r) => accountByPath.get(r.path)?.key === accountKey && !claimedBy.has(r.path))
      .map(makeRepoNode);
    const quietRepos = looseRepos.filter(
      (n) => n.repo.path !== activeRepoPath && isQuietRepo(n, signals, now),
    );
    const activeRepos = looseRepos.filter((n) => !quietRepos.includes(n));
    const key = accountNodeKey(accountKey);
    const order = orderByParent[key];
    return {
      kind: "account",
      key,
      accountKey,
      label: labels.get(accountKey) ?? accountKey,
      sortMode,
      pending: !settledKeys.has(accountKey),
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

import { fuzzyFilter } from "@/lib/fuzzy-search";
import type { BranchInfo, WorktreeInfo } from "@/types";
import { remoteShortName } from "./branch-name";

/**
 * 브랜치 패널(D6) 행의 주 동작.
 * - `current`: 지금 연 워크트리의 브랜치. 동작 없음.
 * - `openWorktree`: 다른 워크트리가 쓰는 브랜치. git은 그 브랜치로 전환하지 못하므로 그 워크트리로 이동한다.
 * - `switch`: 이 워크트리에서 그 브랜치로 전환한다.
 */
export type BranchRowAction = "current" | "openWorktree" | "switch";

export type BranchPanelSection = "inWorktree" | "local" | "remote";

/** 로컬 칸 정렬. `recent`는 최근에 전환한 브랜치 → 최근 커밋순, `name`은 이름순. */
export type BranchPanelSort = "recent" | "name";

export interface BranchPanelRow {
  branch: BranchInfo;
  /** 이 행이 놓인 칸. 둘째 줄에 무엇을 보일지가 칸마다 다르다(시안 D6). */
  section: BranchPanelSection;
  /** 이 브랜치를 체크아웃한 워크트리. 없으면 null. */
  worktree: WorktreeInfo | null;
  action: BranchRowAction;
}

export interface BranchPanelSections {
  /** 워크트리에서 쓰는 중: 어느 워크트리(메인 포함)가 체크아웃한 로컬 브랜치. */
  inWorktree: BranchPanelRow[];
  /** 그 밖의 로컬 브랜치. */
  local: BranchPanelRow[];
  /** 같은 이름의 로컬 브랜치가 없는 원격 브랜치. */
  remote: BranchPanelRow[];
}

function trimSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

const byName = (a: BranchPanelRow, b: BranchPanelRow) => a.branch.name.localeCompare(b.branch.name);
const byRecent = (a: BranchPanelRow, b: BranchPanelRow) =>
  (b.branch.lastCommitTime ?? 0) - (a.branch.lastCommitTime ?? 0) || byName(a, b);

/**
 * 브랜치 목록을 「워크트리에서 쓰는 중 / 로컬 / 원격」 세 칸으로 나누고 행마다 주 동작을 정한다.
 *
 * - `branch.isHead`는 `activePath`(지금 연 워크트리)의 HEAD 기준이다.
 * - 다른 워크트리(메인 워크트리 포함)가 체크아웃한 브랜치는 「이동」이다.
 * - 원격 칸에는 같은 이름의 로컬 브랜치가 없는 원격 브랜치만 둔다(`origin/HEAD` 제외).
 *   로컬이 있으면 체크아웃이 그 로컬로 전환하므로(`switch_branch`) 로컬 행이 그 자리를 맡는다.
 * - 정렬: 워크트리 칸은 지금 브랜치 → 메인 워크트리 → 이름순, 원격 칸은 최근 커밋순.
 *   로컬 칸은 기본 브랜치를 맨 위에 두고, `sortBy`가 `recent`면 최근에 전환한 브랜치
 *   (`recentNames` 순서) → 최근 커밋순, `name`이면 이름순이다.
 *   검색어가 있으면 칸 안에서 일치도 순으로 둔다.
 */
export function classifyBranches(
  branches: readonly BranchInfo[],
  worktrees: readonly WorktreeInfo[],
  activePath: string | null,
  query = "",
  { sortBy = "recent", recentNames = [] }: { sortBy?: BranchPanelSort; recentNames?: readonly string[] } = {},
): BranchPanelSections {
  const active = activePath ? trimSlash(activePath) : null;
  const worktreeByBranch = new Map<string, WorktreeInfo>();
  for (const wt of worktrees) {
    if (wt.branch && !wt.isBare && !worktreeByBranch.has(wt.branch)) worktreeByBranch.set(wt.branch, wt);
  }
  const localNames = new Set(branches.filter((b) => !b.isRemote).map((b) => b.name));

  const inWorktree: BranchPanelRow[] = [];
  const local: BranchPanelRow[] = [];
  const remote: BranchPanelRow[] = [];

  for (const branch of branches) {
    if (branch.isRemote) {
      if (branch.name.endsWith("/HEAD") || localNames.has(remoteShortName(branch.name))) continue;
      remote.push({ branch, section: "remote", worktree: null, action: "switch" });
      continue;
    }
    const worktree = worktreeByBranch.get(branch.name) ?? null;
    const elsewhere = worktree !== null && trimSlash(worktree.path) !== active;
    const action: BranchRowAction = branch.isHead ? "current" : elsewhere ? "openWorktree" : "switch";
    if (branch.isHead || worktree !== null) inWorktree.push({ branch, section: "inWorktree", worktree, action });
    else local.push({ branch, section: "local", worktree, action });
  }

  const worktreeRank = (r: BranchPanelRow) => (r.action === "current" ? 0 : r.worktree?.isMain ? 1 : 2);
  inWorktree.sort((a, b) => worktreeRank(a) - worktreeRank(b) || byName(a, b));
  const recentRank = new Map(recentNames.map((name, i) => [name, i]));
  const byRecentSwitch = (a: BranchPanelRow, b: BranchPanelRow) =>
    (recentRank.get(a.branch.name) ?? Infinity) - (recentRank.get(b.branch.name) ?? Infinity) || byRecent(a, b);
  local.sort(
    (a, b) =>
      Number(b.branch.isDefault) - Number(a.branch.isDefault) ||
      (sortBy === "name" ? byName(a, b) : byRecentSwitch(a, b)),
  );
  remote.sort(byRecent);

  const filter = (rows: BranchPanelRow[]) => fuzzyFilter(rows, query.trim(), (r) => r.branch.name);
  return { inWorktree: filter(inWorktree), local: filter(local), remote: filter(remote) };
}

/** 세 칸의 행을 화면 순서대로 한 줄로. 화살표 키 이동과 기반 브랜치 조회에 쓴다. */
export function flattenSections(sections: BranchPanelSections): BranchPanelRow[] {
  return [...sections.inWorktree, ...sections.local, ...sections.remote];
}

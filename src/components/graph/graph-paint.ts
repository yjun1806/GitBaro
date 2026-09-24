import type { GraphRowLayout } from "@/lib/graph-lanes";
import type { RefLabel } from "@/types";
import { wipLaneOid, worktreeColor } from "./worktree-history";

/**
 * 커밋 그래프의 칠하기 계산(순수 함수). 워크트리 하나에 색 하나: 그 워크트리의 WIP 행과 HEAD가
 * 있는 줄기, 그 워크트리가 체크아웃한 브랜치 이름표가 같은 색이다. 나머지 줄기는 회색이다.
 */

/** 그래프에 함께 그리는 워크트리. */
export interface ShownWorktree {
  path: string;
  branch: string | null;
  /** 그 워크트리의 HEAD 커밋. 모르면 null. */
  head: string | null;
}

/**
 * 줄기 번호 → 워크트리 색. 앞 워크트리가 먼저 차지한다(지금 연 워크트리를 맨 앞에 둔다).
 * WIP 행의 줄기와 HEAD 커밋의 줄기를 칠한다. WIP 행이 있으면 둘은 같은 줄기다.
 */
export function worktreeChainColors(
  layouts: ReadonlyMap<string, GraphRowLayout>,
  shown: readonly ShownWorktree[],
): Map<number, string> {
  const colors = new Map<number, string>();
  for (const w of shown) {
    const color = worktreeColor(w.path);
    for (const oid of [wipLaneOid(w.path), w.head]) {
      const chain = oid ? layouts.get(oid)?.chain : undefined;
      if (chain !== undefined && !colors.has(chain)) colors.set(chain, color);
    }
  }
  return colors;
}

/** 브랜치 이름 → 그 브랜치를 체크아웃한 워크트리의 색. */
export function branchColors(shown: readonly ShownWorktree[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const w of shown) {
    if (w.branch && !out.has(w.branch)) out.set(w.branch, worktreeColor(w.path));
  }
  return out;
}

/**
 * 회색 줄기의 이름: 그 줄기 첫 커밋(가장 최근)에 달린 브랜치 이름. 이름이 없으면 null(「merge됨」).
 * `colored`에 있는 줄기(워크트리 색)는 건너뛴다.
 */
export function mutedChainNames(
  commits: readonly { id: string; refs: readonly RefLabel[] }[],
  layouts: ReadonlyMap<string, GraphRowLayout>,
  colored: ReadonlyMap<number, string>,
): Map<number, string | null> {
  const names = new Map<number, string | null>();
  for (const c of commits) {
    const chain = layouts.get(c.id)?.chain;
    if (chain === undefined || colored.has(chain) || names.has(chain)) continue;
    const branch = c.refs.find((r) => r.kind === "localBranch") ?? c.refs.find((r) => r.kind === "remoteBranch");
    names.set(chain, branch?.name ?? null);
  }
  return names;
}

/**
 * 「원격에 올라간 지점」: 원격에 없는 커밋들 아래 처음 나오는, 원격에 있는 커밋의 번호.
 * 원격에 없는 커밋이 하나도 없거나(모두 올라감) 원격에 있는 커밋을 아직 불러오지 않았으면 null.
 * `isOwn`이 거짓인 커밋(함께 그린 다른 워크트리의 커밋)은 보지 않는다.
 */
export function remoteBoundaryIndex(
  commits: readonly { id: string; isUnpushed?: boolean }[],
  isOwn: (id: string) => boolean,
): number | null {
  let sawUnpushed = false;
  for (let i = 0; i < commits.length; i++) {
    const c = commits[i];
    if (!isOwn(c.id) || c.isUnpushed === undefined) continue;
    if (c.isUnpushed) sawUnpushed = true;
    else if (sawUnpushed) return i;
    else return null;
  }
  return null;
}

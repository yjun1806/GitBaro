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
 * 「원격에 올라간 지점」 행을 둘 자리: **지금 연 워크트리 자신의 이력**(`isOwn`)만 보고 정한다 —
 * 그 이력에서 원격에 없는 커밋 가운데 마지막 것 아래, 처음 나오는 원격에 있는 커밋의 번호. 원격
 * 커밋을 merge해 원격에 없는 커밋 사이에 원격 커밋이 끼어도(자신의 이력 안에서는) 경계는 그 아래로
 * 간다. 함께 그린 다른 워크트리의 커밋(`isOwn: false`, 기본값은 own — 다른 화면에서 부르는 기존
 * 호출은 손대지 않아도 된다)은 경계 위치를 정하는 데는 쓰지 않는다 — 다른 워크트리는 자신과 상관없는
 * 별도의 브랜치라, 그 워크트리의 오래된 커밋 하나 때문에 자신의 경계가 실제보다 아래로 밀리면 그
 * 위에 낀 자신의(이미 올라간) 커밋들이 「아직 안 올라감」처럼 보인다.
 *
 * 다만 경계를 정한 뒤, 그 위(화면에 그려진 모든 행)에 **다른 워크트리의 이미 원격에 있는 커밋**이
 * 하나라도 있으면 아예 그리지 않는다 — 「경계 아래는 모두 원격에 있다」는 참이어도 「경계 위는 아직
 * 안 올라갔다」는 그 커밋 때문에 거짓이 되기 때문이다. (자신의 이력 안에서 원격 커밋이 낀 것은 원래도
 * 허용한다 — merge 커밋이 그 예다.)
 *
 * 자신의 이력에 원격에 없는 커밋이 하나도 없거나(모두 올라감), 그 아래 원격에 있는 커밋을 자신의
 * 이력에서 아직 찾지 못했으면(다음 페이지를 더 불러와야 할 수 있다) null. 원격 여부를 모르는
 * 커밋(`isUnpushed` 없음)은 건너뛴다.
 */
/**
 * 줄기 강조 중(고른 커밋의 줄기, 없으면 마우스 올린 줄기) 이 줄기의 선 하나의 겉모습(D6).
 * `highlightChain`이 null이면 강조 없음(늘 기본값) — 지금 그대로 그린다.
 */
export interface ChainEdgeStyle {
  strokeWidth: number;
  strokeOpacity: number;
}

export function chainEdgeStyle(edgeChain: number, highlightChain: number | null): ChainEdgeStyle {
  if (highlightChain === null) return { strokeWidth: 2, strokeOpacity: 0.9 };
  const onActiveChain = edgeChain === highlightChain;
  return { strokeWidth: onActiveChain ? 2.5 : 2, strokeOpacity: onActiveChain ? 0.9 : 0.45 };
}

/**
 * 줄기 강조 중 커밋 점 하나의 겉모습. 고른 커밋 자신(`isSelected`)이 강조 줄기 위에 있으면
 * 점을 키우고 테를 두른다. 강조 줄기 위의 다른 점은 채운 채 그대로, 다른 줄기는 옅게 흐린다.
 */
export interface ChainDotStyle {
  /** 강조 줄기 위의 고른 커밋 자신인지 — 크게 + 테. */
  ring: boolean;
  /** 0.45(다른 줄기, 강조 중일 때만) 또는 1(강조 없음·강조 줄기 위). */
  opacity: number;
}

export function chainDotStyle(chain: number, highlightChain: number | null, isSelected: boolean): ChainDotStyle {
  if (highlightChain === null) return { ring: false, opacity: 1 };
  const onActiveChain = chain === highlightChain;
  return { ring: isSelected && onActiveChain, opacity: onActiveChain ? 1 : 0.45 };
}

export function remoteBoundaryIndex(
  commits: readonly { isUnpushed?: boolean; isOwn?: boolean }[],
): number | null {
  const isOwn = (i: number) => commits[i].isOwn !== false;
  let lastOwnUnpushed = -1;
  for (let i = 0; i < commits.length; i++) {
    if (isOwn(i) && commits[i].isUnpushed === true) lastOwnUnpushed = i;
  }
  if (lastOwnUnpushed === -1) return null;
  let boundary = -1;
  for (let i = lastOwnUnpushed + 1; i < commits.length; i++) {
    if (isOwn(i) && commits[i].isUnpushed === false) {
      boundary = i;
      break;
    }
  }
  if (boundary === -1) return null;
  for (let i = 0; i < boundary; i++) {
    if (!isOwn(i) && commits[i].isUnpushed === false) return null;
  }
  return boundary;
}

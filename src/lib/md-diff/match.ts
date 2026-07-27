import { diff_match_patch } from "diff-match-patch";
import { blockKey } from "./blocks";
import type { DocDiffOptions } from "./options";
import type { SourceBlock } from "./types";

/**
 * 문서 diff 전체가 쓰는 단 하나의 dmp 인스턴스.
 * `diff_main`/`diff_cleanupSemantic`은 호출 간 상태를 남기지 않으므로 공유해도 안전하다.
 */
export const dmp = new diff_match_patch();

/** 유사도 — 공통 문자 비율. 1이면 같고 0이면 겹치는 글자가 없다. */
export function similarity(a: string, b: string): number {
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  const d = dmp.diff_main(a, b);
  let common = 0;
  for (const [op, text] of d) if (op === 0) common += text.length;
  return common / Math.max(a.length, b.length);
}

export type PairKind = "same" | "modified" | "moved";

export interface BlockPair {
  /** 옛 블록 인덱스. */
  o: number;
  /** 새 블록 인덱스. */
  n: number;
  kind: PairKind;
}

export interface MatchResult {
  pairs: BlockPair[];
  usedO: boolean[];
  usedN: boolean[];
}

/**
 * 옛/새 블록 배열을 짝짓는다.
 *
 * nbdime의 "기준을 점점 느슨하게" 구조 — 엄격 일치부터 잡아야 느슨한 패스가 엉뚱한 짝을
 * 만들지 않는다. 순서는 절대 바꾸지 마라.
 */
export function matchBlocks(
  olds: SourceBlock[],
  news: SourceBlock[],
  opts: DocDiffOptions,
): MatchResult {
  const pairs: BlockPair[] = [];
  const usedO = new Array<boolean>(olds.length).fill(false);
  const usedN = new Array<boolean>(news.length).fill(false);

  // Pass 1 — 정확 일치를 patience 방식으로. 양쪽에서 **유일한** 블록만 앵커로 삼아
  // `}`나 빈 문단처럼 흔한 것이 순서를 뒤엉키게 하는 걸 막는다.
  const countO = new Map<string, number>();
  const countN = new Map<string, number>();
  for (const b of olds) countO.set(blockKey(b), (countO.get(blockKey(b)) ?? 0) + 1);
  for (const b of news) countN.set(blockKey(b), (countN.get(blockKey(b)) ?? 0) + 1);

  const anchors: Array<[number, number]> = [];
  for (let i = 0; i < olds.length; i++) {
    const k = blockKey(olds[i]);
    if (countO.get(k) !== 1 || countN.get(k) !== 1) continue;
    for (let j = 0; j < news.length; j++) {
      if (blockKey(news[j]) === k) {
        anchors.push([i, j]);
        break;
      }
    }
  }
  // 앵커 중 순서가 증가하는 최장 부분열만 남긴다(교차 = 이동이므로 나중 패스로).
  for (const idx of longestIncreasing(anchors.map((a) => a[1]))) {
    const [o, n] = anchors[idx];
    usedO[o] = true;
    usedN[n] = true;
    pairs.push({ o, n, kind: "same" });
  }

  // Pass 1b — 남은 정확 일치를 순서대로(중복 텍스트 블록들).
  for (let o = 0; o < olds.length; o++) {
    if (usedO[o]) continue;
    for (let n = 0; n < news.length; n++) {
      if (usedN[n] || blockKey(news[n]) !== blockKey(olds[o])) continue;
      usedO[o] = true;
      usedN[n] = true;
      pairs.push({ o, n, kind: "same" });
      break;
    }
  }

  // Pass 2 — 유사 매칭. 같은 타입끼리, 앞뒤 순서를 보존하는 짝만.
  for (let o = 0; o < olds.length; o++) {
    if (usedO[o]) continue;
    let best = -1;
    let bestScore = opts.blockSimilarity;
    for (let n = 0; n < news.length; n++) {
      if (usedN[n] || news[n].type !== olds[o].type) continue;
      if (!orderOK(pairs, o, n)) continue;
      const s = similarity(olds[o].norm, news[n].norm);
      if (s >= bestScore) {
        bestScore = s;
        best = n;
      }
    }
    if (best >= 0) {
      usedO[o] = true;
      usedN[best] = true;
      pairs.push({ o, n: best, kind: "modified" });
    }
  }

  // Pass 3 — 이동. 내용은 같은데 자리가 다른 것(순서 보존 조건을 못 맞춰 남은 것들).
  for (let o = 0; o < olds.length; o++) {
    if (usedO[o] || olds[o].norm.length < opts.moveMinChars) continue;
    for (let n = 0; n < news.length; n++) {
      if (usedN[n] || blockKey(news[n]) !== blockKey(olds[o])) continue;
      usedO[o] = true;
      usedN[n] = true;
      pairs.push({ o, n, kind: "moved" });
      break;
    }
  }

  pairs.sort((a, b) => a.n - b.n);
  return { pairs, usedO, usedN };
}

/** 이미 잡힌 짝들과 순서가 어긋나지 않는가(단조성 유지). */
function orderOK(pairs: BlockPair[], oi: number, ni: number): boolean {
  for (const p of pairs) {
    if (p.kind === "moved") continue;
    if (p.o < oi !== p.n < ni) return false;
  }
  return true;
}

/** 최장 증가 부분열의 **인덱스** 목록. */
export function longestIncreasing(arr: number[]): number[] {
  if (!arr.length) return [];
  const tails: number[] = [];
  const prev = new Array<number>(arr.length).fill(-1);
  for (let i = 0; i < arr.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[tails[mid]] < arr[i]) lo = mid + 1;
      else hi = mid;
    }
    prev[i] = lo > 0 ? tails[lo - 1] : -1;
    if (lo === tails.length) tails.push(i);
    else tails[lo] = i;
  }
  const idxs: number[] = [];
  let k = tails[tails.length - 1];
  while (k >= 0) {
    idxs.push(k);
    k = prev[k];
  }
  return idxs.reverse();
}

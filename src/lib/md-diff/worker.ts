import { computeDocDiff } from "./core";
import type { DocDiffModel } from "./types";

/**
 * 문서 diff 계산 Worker.
 *
 * 코어는 블록 매칭에서 O(N²) 후보 순회 × 문자 diff를 돌린다 — 긴 문서에서 수백 ms를 쉽게 넘긴다.
 * 메인 스레드에서 돌리면 그동안 앱 전체가 얼어붙으므로 여기로 밀어낸다.
 * 코어가 DOM을 안 만지기 때문에 그대로 옮겨올 수 있다.
 */

export interface DocDiffRequest {
  id: number;
  oldSrc: string;
  newSrc: string;
}

export type DocDiffResponse =
  | { id: number; ok: true; model: DocDiffModel; ms: number }
  | { id: number; ok: false; error: string };

self.onmessage = (e: MessageEvent<DocDiffRequest>) => {
  const { id, oldSrc, newSrc } = e.data;
  const started = performance.now();
  try {
    const model = computeDocDiff(oldSrc, newSrc);
    const res: DocDiffResponse = { id, ok: true, model, ms: performance.now() - started };
    self.postMessage(res);
  } catch (err) {
    const res: DocDiffResponse = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(res);
  }
};

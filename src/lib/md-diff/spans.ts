import { dmp, similarity } from "./match";
import type { DocDiffOptions } from "./options";
import type { CellSpans, DelSpan, InsSpan, TableCell } from "./types";

/** dmp 연산 코드. -1 삭제, 0 동일, 1 삽입. */
type Op = -1 | 0 | 1;

interface Segment {
  op: Op;
  text: string;
}

export interface TextSpans {
  ins: InsSpan[];
  del: DelSpan[];
  /** 인라인 강조를 포기하고 통째 교체로 넘겨야 하는 상태. */
  tooFragmented?: boolean;
}

/**
 * `Intl.Segmenter`는 ES2022 타입이라 이 프로젝트의 `lib`(ES2021)에는 없다.
 * 전역을 넓히는 대신 여기서 필요한 만큼만 좁게 선언한다.
 */
interface WordSegmenter {
  segment(input: string): Iterable<{ segment: string }>;
}
type SegmenterCtor = new (locale: string, options: { granularity: "word" }) => WordSegmenter;

const SegmenterImpl = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;

/**
 * 어절 분절. 로케일을 `ko`로 고정하는 건 의도다 — 이 모듈의 임계값(`wordSimilarity`,
 * `maxChangeRatio`)이 한국어 문서로 튜닝됐고, UAX#29 단어 경계는 공백 기반이라
 * 영어 문서에서도 같은 결과를 낸다.
 */
export function segmentsOf(s: string): string[] {
  if (SegmenterImpl) {
    const seg = new SegmenterImpl("ko", { granularity: "word" });
    const out: string[] = [];
    for (const part of seg.segment(String(s))) out.push(part.segment);
    return out;
  }
  // 폴백 — 공백 보존 분할.
  return String(s)
    .split(/(\s+)/)
    .filter((t) => t.length);
}

/**
 * 시퀀스(어절·줄)를 사용자 영역 문자로 압축해 dmp의 문자 diff를 시퀀스 diff로 쓴다.
 * dmp의 `linesToChars` 트릭과 같은 원리 — 본문과 충돌하지 않는 코드포인트를 쓴다.
 */
function sequenceDiff(a: string[], b: string[]): Segment[] {
  const map = new Map<string, number>();
  const list: string[] = [];
  const enc = (arr: string[]): string => {
    let out = "";
    for (const w of arr) {
      let id = map.get(w);
      if (id === undefined) {
        id = list.length;
        map.set(w, id);
        list.push(w);
      }
      out += String.fromCharCode(id + 0xe000);
    }
    return out;
  };

  const d = dmp.diff_main(enc(a), enc(b), false);
  const out: Segment[] = [];
  for (const [op, encoded] of d) {
    let text = "";
    for (let j = 0; j < encoded.length; j++) text += list[encoded.charCodeAt(j) - 0xe000];
    if (text.length) out.push({ op: op as Op, text });
  }
  return out;
}

/**
 * 옛/새 텍스트 → **새 텍스트 기준** 변경 스팬 + 삭제 조각.
 *
 * 2층(어절)으로 시작해, 인접 삭제/삽입 쌍이 닮았으면 3층(문자)으로 내려간다.
 * 한국어는 조사가 어절에 붙어("문단을"→"문단이") 어절 단위로만 보면 통째로 빨개진다.
 */
export function textSpans(oldText: string, newText: string, opts: DocDiffOptions): TextSpans {
  const segs = sequenceDiff(segmentsOf(oldText), segmentsOf(newText));

  let ins: InsSpan[] = [];
  let del: DelSpan[] = [];
  let pos = 0;
  for (const s of segs) {
    if (s.op === 0) {
      pos += s.text.length;
    } else if (s.op === 1) {
      ins.push({ start: pos, end: pos + s.text.length });
      pos += s.text.length;
    } else {
      // 삭제: 새 텍스트엔 자리가 없다 — 위치만 기록한다.
      del.push({ at: pos, text: s.text });
    }
  }

  const refined = refineAdjacent(segs, opts);
  if (refined) {
    ins = refined.ins;
    del = refined.del;
  }

  const merged = mergeSpans(ins, opts.mergeDistance);

  // **과분절 방어(어절 단계).** 조각이 너무 많거나 문단 대부분이 바뀌었으면 인라인 강조를
  // 포기하고 통째 교체로 넘긴다 — 삭제·삽입이 단어마다 뒤엉킨 화면은 diff가 아니라 소음이다.
  const changedChars =
    merged.reduce((n, s) => n + (s.end - s.start), 0) + del.reduce((n, d) => n + d.text.length, 0);
  const total = Math.max(1, newText.length);
  // **비율은 긴 문단에서만 본다.** 짧은 문장은 단어 하나만 바꿔도 비율이 쉽게 넘는데
  // 그건 전혀 안 읽히는 화면이 아니다. 단어 수프는 긴 문단에 변경이 흩뿌려질 때만 생긴다.
  const ratioApplies = total >= opts.ratioMinChars;
  if (
    merged.length + del.length > opts.maxWordFragments ||
    (ratioApplies && changedChars / total > opts.maxChangeRatio)
  ) {
    return { ins: merged, del, tooFragmented: true };
  }
  return { ins: merged, del };
}

/** 인접 삭제/삽입 쌍의 문자 단위 세분(3층). */
function refineAdjacent(
  segs: Segment[],
  opts: DocDiffOptions,
): { ins: InsSpan[]; del: DelSpan[] } | null {
  let changed = false;
  const ins: InsSpan[] = [];
  const del: DelSpan[] = [];
  let pos = 0;

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const next = segs[i + 1];
    // 삭제 바로 뒤 삽입이 오는 "교체" 구간만 후보다.
    if (s.op === -1 && next && next.op === 1) {
      const a = s.text;
      const b = next.text;
      if (a.length >= 2 && b.length >= 2 && similarity(a, b) >= opts.wordSimilarity) {
        const fine = charDiff(a, b, opts);
        if (fine) {
          changed = true;
          for (const f of fine) {
            if (f.op === 0) {
              pos += f.text.length;
            } else if (f.op === 1) {
              ins.push({ start: pos, end: pos + f.text.length });
              pos += f.text.length;
            } else {
              del.push({ at: pos, text: f.text });
            }
          }
          i++; // 짝지은 삽입 세그먼트를 소비했다
          continue;
        }
      }
    }
    if (s.op === 0) pos += s.text.length;
    else if (s.op === 1) {
      ins.push({ start: pos, end: pos + s.text.length });
      pos += s.text.length;
    } else {
      del.push({ at: pos, text: s.text });
    }
  }
  return changed ? { ins, del } : null;
}

/** 문자 diff + cleanupSemantic + 과분절 상한. 너무 잘게 쪼개지면 null(통째 교체로 남긴다). */
function charDiff(a: string, b: string, opts: DocDiffOptions): Segment[] | null {
  const d = dmp.diff_main(a, b);
  dmp.diff_cleanupSemantic(d);
  let frags = 0;
  const commonRuns: number[] = [];
  for (const [op, text] of d) {
    if (op === 0) commonRuns.push(text.length);
    else frags++;
  }
  if (frags > opts.maxFragments) return null;
  if (commonRuns.length) {
    const avg = commonRuns.reduce((x, y) => x + y, 0) / commonRuns.length;
    if (avg < opts.minCommonRun) return null; // 공통 조각이 잘면 읽히지 않는다
  }
  return d.map(([op, text]) => ({ op: op as Op, text }));
}

/** 가까운 스팬 병합 — 하이라이트가 조각조각 나는 걸 막는다. */
export function mergeSpans(spans: InsSpan[], distance: number): InsSpan[] {
  if (spans.length < 2) return spans;
  const sorted = spans.slice().sort((x, y) => x.start - y.start);
  const out: InsSpan[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    if (sorted[i].start - last.end <= distance) last.end = Math.max(last.end, sorted[i].end);
    else out.push({ ...sorted[i] });
  }
  return out;
}

/**
 * 코드블록 내부 — **줄 단위** diff. 코드에 어절 하이라이트를 치면 안 읽힌다.
 * 반환 스팬의 오프셋은 새 코드 텍스트 기준이고, 렌더된 `<code>`의 textContent와 일치한다.
 */
export function codeLineSpans(oldCode: string, newCode: string): TextSpans {
  const segs = sequenceDiff(
    String(oldCode).split("\n").map(withNewline),
    String(newCode).split("\n").map(withNewline),
  );
  const ins: InsSpan[] = [];
  const del: DelSpan[] = [];
  let pos = 0;
  for (const s of segs) {
    if (s.op === 0) {
      pos += s.text.length;
    } else if (s.op === 1) {
      ins.push({ start: pos, end: pos + s.text.length });
      pos += s.text.length;
    } else {
      del.push({ at: pos, text: s.text });
    }
  }
  return { ins, del };
}

function withNewline(line: string): string {
  return line + "\n";
}

/**
 * 표 내부 — **칸 단위** 매칭 후 칸 안에서 어절 diff.
 * 표 구조(행·열 추가)는 diff하지 않는다 — 좌표가 어긋나면 null을 돌려 통짜 변경으로 물러선다.
 */
export function tableCellSpans(
  oldCells: TableCell[] | undefined,
  newCells: TableCell[] | undefined,
  opts: DocDiffOptions,
): CellSpans[] | null {
  if (!oldCells || !newCells) return null;
  const byKey = new Map<string, string>();
  for (const c of oldCells) byKey.set(`${c.row},${c.col}`, c.text);

  const out: CellSpans[] = [];
  for (const c of newCells) {
    const prev = byKey.get(`${c.row},${c.col}`);
    if (prev === undefined) return null; // 구조가 바뀌었다 — 칸 매칭을 포기한다
    if (prev === c.text) continue;
    let spans = textSpans(prev, c.text, opts);
    if (spans.tooFragmented) spans = { ins: [{ start: 0, end: c.text.length }], del: [] };
    out.push({ row: c.row, col: c.col, ins: spans.ins, del: spans.del });
  }
  return out;
}

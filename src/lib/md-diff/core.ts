import { blockHtml, toBlocks } from "./blocks";
import { matchBlocks } from "./match";
import { DEFAULT_OPTIONS, type DocDiffOptions } from "./options";
import { codeLineSpans, tableCellSpans, textSpans, type TextSpans } from "./spans";
import type { DiffBlock, DocDiffModel, DocDiffStats, SourceBlock } from "./types";

/**
 * 문서 diff 모델을 만든다. DOM은 만지지 않는다 — 여기서는 **무엇이 어디서 바뀌었나**와
 * 블록별 HTML만 낸다. 실제 페인팅(하이라이트·삭제 글자 삽입)은 `paint.ts`가 한다.
 *
 * 반환 `blocks`는 **새 문서 기준 순서**이고, 삭제 블록은 있던 자리에 끼워 넣는다
 * (그래야 "여기서 뭐가 없어졌다"를 그 자리에서 말할 수 있다).
 */
export function computeDocDiff(
  oldSrc: string,
  newSrc: string,
  options?: Partial<DocDiffOptions>,
): DocDiffModel {
  const opts: DocDiffOptions = { ...DEFAULT_OPTIONS, ...options };

  const olds = toBlocks(oldSrc);
  const news = toBlocks(newSrc);
  const m = matchBlocks(olds, news, opts);

  const byNew = new Map(m.pairs.map((p) => [p.n, p]));
  const blocks: DiffBlock[] = [];
  const stats: DocDiffStats = { inserted: 0, deleted: 0, modified: 0, moved: 0 };

  // 삭제 블록을 "옛 순서상 그다음 블록이 새 문서에서 어디였나"에 매달아 끼워 넣는다.
  const pendingDel = new Map<number, SourceBlock[]>();
  for (let o = 0; o < olds.length; o++) {
    if (m.usedO[o]) continue;
    let anchor = news.length; // 기본은 문서 끝
    for (const p of m.pairs) if (p.o > o) anchor = Math.min(anchor, p.n);
    const list = pendingDel.get(anchor);
    if (list) list.push(olds[o]);
    else pendingDel.set(anchor, [olds[o]]);
  }

  const flushDel = (at: number) => {
    for (const b of pendingDel.get(at) ?? []) {
      blocks.push(toDiffBlock(b, "deleted", oldSrc));
      stats.deleted++;
    }
  };

  for (let n = 0; n < news.length; n++) {
    flushDel(n);
    const b = news[n];
    const pair = byNew.get(n);

    if (!pair) {
      blocks.push(toDiffBlock(b, "inserted", newSrc));
      stats.inserted++;
      continue;
    }
    if (pair.kind === "same") {
      blocks.push(toDiffBlock(b, "same", newSrc));
      continue;
    }
    if (pair.kind === "moved") {
      blocks.push({ ...toDiffBlock(b, "moved", newSrc), fromLine: olds[pair.o].line });
      stats.moved++;
      continue;
    }

    // modified — 2·3층으로 내려가 스팬을 뽑는다.
    // 코드·표는 어절 스팬을 쓰지 않는다. 코드는 **줄**, 표는 **칸**.
    // 어절 오프셋을 그대로 쓰면 셀 경계를 넘어 엉뚱한 칸이 칠해진다.
    const old = olds[pair.o];
    let spans: TextSpans;
    let codeLines = false;
    let wholeCode = false;
    let cells = null as DiffBlock["cells"];

    if (b.type === "html") {
      // 생 HTML 블록은 텍스트 프로젝션(= 소스)과 렌더된 `textContent`가 다르다.
      // 그 좌표로 칠하면 엉뚱한 글자가 칠해지므로 내부를 짚지 않는다.
      spans = { ins: [], del: [] };
      wholeCode = true;
    } else if (b.type === "code") {
      spans = codeLineSpans(old.text, b.text);
      codeLines = true;
    } else if (b.type === "table") {
      cells = tableCellSpans(old.cells, b.cells, opts);
      // 칸 매칭이 안 되면(행·열 구조 변경) 통짜 변경으로 물러선다 — 지어내지 않는다.
      spans = { ins: [], del: [] };
      wholeCode = cells === null;
    } else {
      spans = textSpans(old.text, b.text, opts);
    }

    // 너무 잘게 쪼개졌으면 **옛 블록 통째 삭제 + 새 블록 통째 삽입**으로 보여준다.
    // 어느 단어가 바뀌었는지 못 읽는 화면보다, 두 판을 나란히 보는 쪽이 정직하다.
    if (spans.tooFragmented) {
      blocks.push(toDiffBlock(old, "deleted", oldSrc));
      blocks.push(toDiffBlock(b, "inserted", newSrc));
      stats.deleted++;
      stats.inserted++;
      continue;
    }

    blocks.push({
      ...toDiffBlock(b, "modified", newSrc),
      oldText: old.text,
      ins: spans.ins,
      del: spans.del,
      codeLines,
      wholeCode,
      cells,
    });
    stats.modified++;
  }
  flushDel(news.length);

  return { blocks, stats };
}

/** 매칭된 블록 → 모델 블록. `src`는 이 블록이 살던 쪽 원문이다(삭제는 옛 문서). */
function toDiffBlock(b: SourceBlock, kind: DiffBlock["kind"], src: string): DiffBlock {
  return {
    kind,
    type: b.type,
    info: b.info,
    text: b.text,
    html: blockHtml(src, b),
    line: b.line,
    listTag: b.listTag,
    listId: b.listId,
    listDepth: b.listDepth,
  };
}

export { DEFAULT_OPTIONS } from "./options";
export type { DocDiffOptions } from "./options";
export type * from "./types";

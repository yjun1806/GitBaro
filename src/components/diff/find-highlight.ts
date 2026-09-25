import { forEachMatch, MAX_FIND_MATCHES } from "./diff-find";

// 찾은 곳을 화면에 칠한다. diff 줄은 라이브러리가 만든 HTML 문자열로, 문서 보기는 `paint`가
// 직접 만든 DOM으로 그려진다 — 어느 쪽도 React가 글자 단위로 소유하지 않아 <mark>로 감싸면
// 다음 렌더에 날아가거나 남는다. 그래서 DOM은 건드리지 않고 CSS Custom Highlight API로 칠한다.
// (지원하지 않는 웹뷰에서는 칠하지 않을 뿐, 세기와 이동은 그대로 된다.)

/** diff-theme.css의 `::highlight(...)` 이름과 같아야 한다. */
const ALL = "diff-find";
const CURRENT = "diff-find-current";

function registry(): HighlightRegistry | null {
  if (typeof CSS === "undefined" || !("highlights" in CSS) || typeof Highlight !== "function") return null;
  return CSS.highlights;
}

/** `root` 아래 글 노드들. */
export function textNodesOf(root: Node): Text[] {
  const out: Text[] = [];
  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}

/**
 * 이어 붙인 글 노드들에서 일치를 찾아 Range로. 한 일치가 노드 경계(강조 태그)를 넘어도 된다.
 */
export function rangesIn(nodes: Text[], re: RegExp): Range[] {
  if (nodes.length === 0) return [];
  const starts: number[] = [];
  let text = "";
  for (const n of nodes) {
    starts.push(text.length);
    text += n.data;
  }
  // 오프셋 → (노드, 노드 안 위치). 끝 경계는 앞 노드의 끝으로 잡는다.
  const locate = (offset: number, isEnd: boolean): [Text, number] => {
    let i = 0;
    while (i + 1 < nodes.length && (isEnd ? starts[i + 1] < offset : starts[i + 1] <= offset)) i++;
    return [nodes[i], offset - starts[i]];
  };
  const doc = nodes[0].ownerDocument;
  const ranges: Range[] = [];
  forEachMatch(text, re, (start, end) => {
    const range = doc.createRange();
    range.setStart(...locate(start, false));
    range.setEnd(...locate(end, true));
    ranges.push(range);
  });
  return ranges;
}

/** 문서 보기에서 한 덩어리로 찾을 블록. 문단 끝과 다음 문단 첫머리가 이어져 찾히지 않게 끊는다. */
const BLOCK = "p, li, h1, h2, h3, h4, h5, h6, td, th, pre, blockquote, dt, dd, figcaption";

/**
 * 렌더된 문서에서 블록마다 찾는다. 버튼(「옮겨짐」 같은 표시)의 글은 문서 내용이 아니라 뺀다.
 * `limit`개에서 멈추고 `capped`로 알린다.
 */
export function documentRanges(root: Element, re: RegExp, limit = MAX_FIND_MATCHES): { ranges: Range[]; capped: boolean } {
  const groups: Text[][] = [];
  let lastBlock: Element | null | undefined;
  for (const node of textNodesOf(root)) {
    const parent = node.parentElement;
    if (!parent || parent.closest("button")) continue;
    const block = parent.closest(BLOCK);
    if (groups.length === 0 || block !== lastBlock) groups.push([]);
    groups[groups.length - 1].push(node);
    lastBlock = block;
  }
  const ranges: Range[] = [];
  for (const group of groups) {
    for (const r of rangesIn(group, re)) {
      if (ranges.length >= limit) return { ranges, capped: true };
      ranges.push(r);
    }
  }
  return { ranges, capped: false };
}

/** 찾은 곳을 모두 옅게, 지금 것만 진하게 칠한다. `all`에 `current`가 들어 있어도 된다. */
export function paintFindHighlights(all: Range[], current: Range | null): void {
  const reg = registry();
  if (!reg) return;
  reg.set(ALL, new Highlight(...all.filter((r) => r !== current)));
  if (current) reg.set(CURRENT, new Highlight(current));
  else reg.delete(CURRENT);
}

export function clearFindHighlights(): void {
  const reg = registry();
  reg?.delete(ALL);
  reg?.delete(CURRENT);
}

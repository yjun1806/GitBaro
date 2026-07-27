import type { CellSpans, DelSpan, DiffBlock, DocDiffModel, InsSpan } from "./types";

/**
 * 모델을 DOM에 그린다. **DOM 전담**(계산과 마크다운 렌더는 `core.ts`).
 *
 * muxa는 CSS Custom Highlight API를 주 경로로 쓰고 span 삽입을 폴백으로 뒀지만,
 * 이 앱은 최소 타깃이 macOS 10.15라 **대부분의 기기에서 폴백이 유일한 경로**가 된다.
 * 코드 경로를 둘로 두면 실제로 도는 쪽이 덜 검증되므로 span 삽입 하나로 통일한다.
 * 대신 muxa 폴백이 포기했던 "텍스트 노드를 걸치는 스팬"까지 조각내어 제대로 칠한다.
 */

export interface PaintLabels {
  /** 접힌 삭제 묶음 — "삭제된 블록 3개 · 120자" */
  deletedBlocks: (count: number, chars: number) => string;
  moved: string;
  tableStructureChanged: string;
  codeChanged: string;
}

/** 삭제 묶음을 접기 시작하는 개수. 이하는 그 자리에 펼쳐 둔다. */
const INLINE_DELETE_LIMIT = 2;

/** 모델이 준 블록 HTML을 요소로. 한 겹 벗겨 문단·헤딩이 바로 앉게 한다. */
function toElement(html: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  const only = wrap.children.length === 1 ? wrap.firstElementChild : null;
  if (only instanceof HTMLElement) return only;
  const frag = document.createElement("div");
  while (wrap.firstChild) frag.appendChild(wrap.firstChild);
  return frag;
}

// ── 오프셋 → DOM 좌표 ───────────────────────────────────────────────────────

interface TextEntry {
  node: Text;
  at: number;
  len: number;
}

/** 텍스트 노드 인덱스 — 오프셋을 노드 좌표로 되돌리기 위한 역인덱스. */
function textEntries(root: Element): TextEntry[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const out: TextEntry[] = [];
  let total = 0;
  let n = walker.nextNode();
  while (n) {
    const node = n as Text;
    out.push({ node, at: total, len: node.data.length });
    total += node.data.length;
    n = walker.nextNode();
  }
  return out;
}

function totalLength(entries: TextEntry[]): number {
  const last = entries[entries.length - 1];
  return last ? last.at + last.len : 0;
}

function locate(entries: TextEntry[], offset: number): { node: Text; offset: number } | null {
  for (const e of entries) {
    if (offset <= e.at + e.len) return { node: e.node, offset: Math.max(0, offset - e.at) };
  }
  const last = entries[entries.length - 1];
  return last ? { node: last.node, offset: last.len } : null;
}

/**
 * 삽입·수정 스팬을 `<span class=cls>`로 감싼다.
 *
 * **텍스트 총량을 바꾸지 않는다** — `splitText`로 쪼개고 감쌀 뿐이라 오프셋 좌표계가 보존된다.
 * 이 성질 덕에 뒤에 오는 `insertDeletions`가 같은 좌표를 그대로 쓸 수 있다.
 */
export function paintSpans(root: Element, spans: InsSpan[] | undefined, cls: string): void {
  if (!spans?.length) return;
  const entries = textEntries(root);
  if (!entries.length) return;

  // 뒤에서 앞으로 — 앞부터 감싸면 같은 노드의 뒤쪽 조각 좌표가 흔들린다.
  // (`splitText`는 원본 노드에 앞 조각을 남기므로 더 작은 오프셋은 계속 유효하다.)
  for (let i = spans.length - 1; i >= 0; i--) {
    wrapSpan(entries, spans[i], cls);
  }
}

function wrapSpan(entries: TextEntry[], span: InsSpan, cls: string): void {
  // 스팬이 걸치는 텍스트 노드마다 조각을 만든다 — `**굵게** 걸친 변경`도 그대로 칠해진다.
  const pieces: Array<{ node: Text; from: number; to: number }> = [];
  for (const e of entries) {
    const from = Math.max(span.start, e.at) - e.at;
    const to = Math.min(span.end, e.at + e.len) - e.at;
    if (to > from) pieces.push({ node: e.node, from, to });
  }

  for (let i = pieces.length - 1; i >= 0; i--) {
    const { node, from, to } = pieces[i];
    let target = node;
    if (to < target.data.length) target.splitText(to);
    if (from > 0) target = target.splitText(from);
    const parent = target.parentNode;
    if (!parent) continue;
    const wrapper = document.createElement("span");
    wrapper.className = cls;
    parent.replaceChild(wrapper, target);
    wrapper.appendChild(target);
  }
}

/**
 * 삭제 조각을 본문 흐름 안에 되살린다.
 *
 * 삭제된 글자는 새 문서 DOM에 없으므로 되살려 넣는 수밖에 없다 — 상용 도구(GitHub·Word·
 * Docs·Confluence) 전원이 같은 선택을 했다.
 *
 * **반드시 `paintSpans` 뒤에 불러야 한다.** 이 함수는 텍스트를 *추가*하므로, 먼저 부르면
 * 그다음 삽입 스팬의 오프셋이 삭제 글자 길이만큼 밀려 엉뚱한 자리가 칠해진다.
 */
export function insertDeletions(root: Element, dels: DelSpan[] | undefined): void {
  if (!dels?.length) return;
  const entries = textEntries(root);
  if (!entries.length) return;
  const total = totalLength(entries);

  // 뒤에서 앞으로 — 앞부터 넣으면 뒤 오프셋이 밀린다.
  const sorted = dels.slice().sort((a, b) => a.at - b.at);
  for (let i = sorted.length - 1; i >= 0; i--) {
    const d = sorted[i];
    const at = locate(entries, Math.min(d.at, total));
    if (!at) continue;
    const mark = document.createElement("del");
    mark.className = "d-deltext";
    mark.textContent = d.text;
    const rest = at.node.splitText(Math.min(at.offset, at.node.data.length));
    rest.parentNode?.insertBefore(mark, rest);
  }
}

// ── 리스트 중첩 복원 ────────────────────────────────────────────────────────

interface ListLevel {
  id: string;
  el: HTMLElement;
}

/**
 * 열려 있는 리스트들. 인덱스가 곧 깊이(0-based)다.
 *
 * 이게 없으면 깊이를 무시하고 새 리스트를 전부 최상위에 형제로 붙이게 되어,
 * 3단 중첩이 나란한 `<ul>` 세 개로 평평해진다(실측으로 확인한 회귀).
 */
class ListStack {
  private levels: ListLevel[] = [];

  constructor(private readonly host: HTMLElement) {}

  reset(): void {
    this.levels = [];
  }

  /** 이 블록이 들어갈 리스트 요소. 리스트 밖이면 `host`. */
  containerFor(b: DiffBlock): HTMLElement {
    if (!b.listId || b.listDepth < 1) {
      this.reset();
      return this.host;
    }
    const depth = b.listDepth;
    const current = this.levels[depth - 1];
    if (current && current.id === b.listId) {
      this.levels.length = depth; // 더 깊은 리스트는 여기서 닫힌다
      return current.el;
    }
    // 새 리스트를 연다. 중첩이면 부모의 마지막 `<li>` 안에 들어가야 HTML이 유효하다.
    this.levels.length = Math.min(this.levels.length, depth - 1);
    const parent = this.levels.length
      ? lastItemOf(this.levels[this.levels.length - 1].el)
      : this.host;
    const el = document.createElement(b.listTag ?? "ul");
    parent.appendChild(el);
    this.levels.push({ id: b.listId, el });
    return el;
  }
}

function lastItemOf(listEl: HTMLElement): HTMLElement {
  const last = listEl.lastElementChild;
  if (last instanceof HTMLElement && last.tagName === "LI") return last;
  // 항목 없이 하위 리스트부터 나오는 경우(빈 부모 항목) — 담을 `<li>`를 만든다.
  const li = document.createElement("li");
  listEl.appendChild(li);
  return li;
}

/** 리스트 항목이면 렌더 결과에서 `<li>`만 꺼내 공용 리스트에 넣는다. */
function place(parent: HTMLElement, el: HTMLElement, isList: boolean): HTMLElement {
  if (!isList) {
    parent.appendChild(el);
    return el;
  }
  const li = el.tagName === "LI" ? el : el.querySelector("li");
  if (!(li instanceof HTMLElement)) {
    parent.appendChild(el);
    return el;
  }
  // 클래스·앵커를 li로 옮긴다(레일이 항목에 붙어야 한다).
  li.className = el.className;
  for (const attr of ["data-line", "data-side", "data-change"]) {
    const v = el.getAttribute(attr);
    if (v !== null) li.setAttribute(attr, v);
  }
  parent.appendChild(li);
  return li;
}

// ── 블록 장식 ───────────────────────────────────────────────────────────────

/** 코멘트·스크롤 앵커 — 블록이 원문 어느 줄에서 왔는지 남긴다(core는 0-based). */
function stampAnchor(el: HTMLElement, b: DiffBlock, side: "add" | "del"): void {
  el.setAttribute("data-line", String((b.line || 0) + 1));
  el.setAttribute("data-side", side);
}

const KIND_CLASS: Record<string, string> = {
  inserted: "d-ins",
  modified: "d-mod",
  moved: "d-mov",
};

function decorateDeleted(b: DiffBlock): HTMLElement {
  const el = toElement(b.html);
  el.classList.add("d-blk", "d-del", "d-delblock");
  el.setAttribute("data-change", "deleted");
  stampAnchor(el, b, "del");
  return el;
}

/**
 * 삭제된 블록 묶음 — 적으면 그 자리에 펼쳐 두고, 많으면 접힌 칩으로 묶는다.
 * 지운 걸 다 펼쳐 놓으면 "최종본이 어떤 모습인가"가 안 읽힌다.
 */
function renderDeletedRun(run: DiffBlock[], labels: PaintLabels): HTMLElement[] {
  if (run.length <= INLINE_DELETE_LIMIT) return run.map(decorateDeleted);

  const chars = run.reduce((n, b) => n + (b.text || "").length, 0);
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "d-delchip";
  chip.setAttribute("data-change", "deleted");
  chip.textContent = labels.deletedBlocks(run.length, chars);
  chip.addEventListener("click", () => {
    const frag = document.createDocumentFragment();
    for (const b of run) frag.appendChild(decorateDeleted(b));
    chip.parentNode?.replaceChild(frag, chip);
  });
  return [chip];
}

function paintModified(placed: HTMLElement, b: DiffBlock, labels: PaintLabels): void {
  if (b.wholeCode) {
    // 내부를 짚을 수 없는 경우에만 — 표의 행·열 구조가 바뀌면 칸 좌표를 지어낼 수 없다.
    const badge = document.createElement("div");
    badge.className = "d-atombadge";
    badge.textContent = b.type === "table" ? labels.tableStructureChanged : labels.codeChanged;
    placed.insertBefore(badge, placed.firstChild);
    return;
  }
  if (b.cells) {
    // 표 — 표 전체 텍스트 오프셋을 쓰면 셀 경계를 넘어 엉뚱한 칸이 칠해진다.
    paintCells(placed, b.cells);
    return;
  }
  // 코드블록은 `<code>` 안의 textContent가 소스와 같으므로 같은 오프셋 기계를 그대로 쓴다.
  const target = b.codeLines ? (placed.querySelector("code") ?? placed) : placed;
  // 순서 주의 — 칠하기가 먼저, 삭제 글자 삽입이 나중.
  paintSpans(target, b.ins, "d-mod-text");
  insertDeletions(target, b.del);
}

/** 표의 바뀐 칸에 표시를 건다. 행·열 좌표로 찾는다(헤더가 0행). */
function paintCells(host: HTMLElement, cells: CellSpans[]): void {
  const table = host instanceof HTMLTableElement ? host : host.querySelector("table");
  if (!table) return;
  for (const c of cells) {
    const cell = table.rows[c.row]?.cells[c.col];
    if (!cell) continue;
    cell.classList.add("d-cell");
    paintSpans(cell, c.ins, "d-mod-text");
    insertDeletions(cell, c.del);
  }
}

function paintChanged(placed: HTMLElement, b: DiffBlock, labels: PaintLabels): void {
  if (b.kind === "inserted") {
    // 통째 삽입이면 블록 전체를 칠한다.
    const len = totalLength(textEntries(placed));
    if (len) paintSpans(placed, [{ start: 0, end: len }], "d-ins-text");
    return;
  }
  if (b.kind === "modified") {
    paintModified(placed, b, labels);
    return;
  }
  if (b.kind === "moved") {
    const mark = document.createElement("span");
    mark.className = "d-movemark";
    mark.textContent = labels.moved;
    placed.appendChild(mark);
  }
}

// ── 진입점 ──────────────────────────────────────────────────────────────────

/** 모델을 `host` 안에 그린다. 기존 내용은 비운다. */
export function paint(host: HTMLElement, model: DocDiffModel, labels: PaintLabels): void {
  host.textContent = "";

  const lists = new ListStack(host);
  let pendingDel: DiffBlock[] = [];

  const flushDeletions = () => {
    if (!pendingDel.length) return;
    for (const el of renderDeletedRun(pendingDel, labels)) host.appendChild(el);
    pendingDel = [];
    lists.reset(); // 삭제 묶음이 끼면 리스트가 끊긴다
  };

  for (const b of model.blocks) {
    if (b.kind === "deleted") {
      pendingDel.push(b);
      continue;
    }
    flushDeletions();

    const el = toElement(b.html);
    el.classList.add("d-blk");
    stampAnchor(el, b, "add");
    const kindClass = KIND_CLASS[b.kind];
    if (kindClass) {
      el.classList.add(kindClass);
      el.setAttribute("data-change", b.kind);
    }

    // 리스트 항목이면 여기서 `<li>`로 바뀌어 공용 리스트에 들어간다 —
    // 이후 하이라이트·삭제 삽입은 **실제로 화면에 붙은 요소**에 걸어야 한다.
    const parent = lists.containerFor(b);
    const placed = place(parent, el, parent !== host);

    paintChanged(placed, b, labels);
  }
  flushDeletions();
}

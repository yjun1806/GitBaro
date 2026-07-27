import type Token from "markdown-it/lib/token.mjs";
import { md } from "./md";
import type { BlockType, SourceBlock, TableCell } from "./types";

/**
 * markdown-it 토큰 트리 → 블록 배열.
 *
 * **렌더된 HTML끼리 diff하지 않는다.** 그건 `<ins>`/`<del>`이 블록 경계를 못 넘는 명세 제약과
 * 태그 짝 깨짐에 정면으로 부딪힌다. 여기서 블록 분해가 **먼저** 일어나므로 모든 변경 조각이
 * 태생적으로 한 블록 안에 갇힌다 — 그게 이 설계의 핵심 불변식이다.
 *
 * 원자는 "사람이 한 덩어리로 읽는 것"이다: 리스트는 통짜가 아니라 **항목**.
 * 그래야 항목 하나 추가가 리스트 전체 교체로 보이지 않는다.
 */
const BLOCK_OPEN: Record<string, BlockType> = {
  heading_open: "heading",
  paragraph_open: "paragraph",
  blockquote_open: "blockquote",
  list_item_open: "list_item",
};

/**
 * **표는 통째로 원자다.** 행 하나(`| 하나 | 1 |`)는 헤더·구분선 없이는 유효한 표 문법이
 * 아니라, 행 단위로 잘라 다시 렌더하면 생 파이프 텍스트가 된다.
 * 대신 셀 좌표를 따로 기억해 "어느 칸이 바뀌었나"는 칸 안에서 짚는다.
 */
const BLOCK_SELF: Record<string, BlockType> = {
  fence: "code",
  code_block: "code",
  hr: "hr",
  html_block: "html",
};

interface ListFrame {
  tag: "ul" | "ol";
  id: string;
}

interface OpenFrame {
  kind: BlockType;
  tok: Token;
  text: string;
  raw: string;
  /** 열 때의 블록 개수 — 닫을 때 "내 안에서 블록이 나왔나"를 이걸로 안다. */
  mark: number;
}

interface TableFrame {
  tok: Token;
  text: string;
  raw: string;
  cells: TableCell[];
  row: number;
  col: number;
}

/**
 * 인라인 토큰 → **렌더되면 실제로 텍스트 노드가 될 글자들**.
 *
 * `token.content`를 그대로 쓰면 안 된다 — 그건 `**굵은** 부분` 같은 **원본 마크다운 소스**라
 * 렌더된 DOM의 `textContent`("굵은 부분")보다 길다. 그 좌표로 하이라이트를 칠하면 마크업
 * 기호 길이만큼 밀려 엉뚱한 글자가 칠해지거나, 텍스트 끝을 넘어 아무것도 안 칠해진다.
 *
 * 이미지는 0자다 — `alt`는 텍스트 노드가 아니라 속성이라 DOM 텍스트에 안 들어간다.
 */
function inlineText(tok: Token): string {
  const children = tok.children;
  if (!children) return tok.content;
  let out = "";
  for (const c of children) {
    if (c.type === "text" || c.type === "code_inline") out += c.content;
    else if (c.type === "softbreak" || c.type === "hardbreak") out += "\n";
  }
  return out;
}

export function toBlocks(src: string): SourceBlock[] {
  const tokens = md.parse(src || "", {});
  const blocks: SourceBlock[] = [];
  const stack: OpenFrame[] = [];
  // 리스트 소속 추적 — 항목마다 따로 렌더하면 `<ul>`이 항목 수만큼 쪼개지고,
  // 순서 리스트는 번호가 전부 1로 초기화된다.
  const lists: ListFrame[] = [];
  let listSeq = 0;
  let table: TableFrame | null = null;

  for (const t of tokens) {
    if (t.type === "table_open") {
      table = { tok: t, text: "", raw: "", cells: [], row: -1, col: 0 };
      continue;
    }
    if (t.type === "table_close") {
      if (table) {
        const tb = mkBlock(
          "table",
          table.text,
          table.raw,
          table.tok.map,
          "",
          lists,
        );
        tb.cells = table.cells;
        blocks.push(tb);
        table = null;
      }
      continue;
    }
    if (table) {
      if (t.type === "tr_open") {
        table.row++;
        table.col = 0;
      } else if (t.type === "inline") {
        const projected = inlineText(t);
        table.text += projected + " ";
        table.raw += t.content + " ";
        table.cells.push({ row: table.row, col: table.col++, text: projected });
      }
      continue; // 표 안의 tr/td는 블록으로 세지 않는다
    }

    if (t.type === "bullet_list_open" || t.type === "ordered_list_open") {
      lists.push({ tag: t.type === "ordered_list_open" ? "ol" : "ul", id: `L${listSeq++}` });
      continue;
    }
    if (t.type === "bullet_list_close" || t.type === "ordered_list_close") {
      lists.pop();
      continue;
    }
    if (BLOCK_SELF[t.type]) {
      // 코드펜스·HTML 블록은 내용이 곧 텍스트다 — 프로젝션과 원본이 같다.
      const content = t.content || "";
      blocks.push(
        mkBlock(
          BLOCK_SELF[t.type],
          content,
          content,
          t.map,
          t.info || "",
          lists,
        ),
      );
      continue;
    }
    if (BLOCK_OPEN[t.type]) {
      stack.push({ kind: BLOCK_OPEN[t.type], tok: t, text: "", raw: "", mark: blocks.length });
      continue;
    }
    if (t.type === "inline" && stack.length) {
      const open = stack[stack.length - 1];
      open.text += inlineText(t);
      open.raw += t.content;
      continue;
    }
    if (t.nesting === -1 && stack.length) {
      const open = stack[stack.length - 1];
      const opener = t.type.replace("_close", "_open");
      if (BLOCK_OPEN[opener] === open.kind) {
        stack.pop();
        // **잎 컨테이너만 원자로 삼는다.** 리스트 항목·인용은 안에 문단을 품는데, 바깥까지
        // 블록으로 뱉으면 같은 내용이 두 번 세어져 "항목 하나 추가"가 2개 삽입으로 보인다.
        const emittedChild = blocks.length > open.mark;
        if (!emittedChild && open.raw.length) {
          blocks.push(
            mkBlock(
              open.kind,
              open.text,
              open.raw,
              open.tok.map,
              open.kind === "heading" ? open.tok.tag : "",
              lists,
            ),
          );
        }
      }
    }
  }
  return blocks;
}

function mkBlock(
  type: BlockType,
  text: string,
  raw: string,
  map: [number, number] | null,
  info: string,
  lists: ListFrame[],
): SourceBlock {
  const list = lists[lists.length - 1];
  return {
    type,
    text,
    raw,
    info: info || "",
    // 같은 리스트에 속한 연속 항목은 렌더러가 하나의 `<ul>`/`<ol>`로 묶는다.
    listTag: list ? list.tag : null,
    listId: list ? list.id : null,
    // 열린 리스트 개수가 곧 중첩 깊이다(1-based). 이게 없으면 렌더러가 중첩을 복원하지 못해
    // 3단 중첩 리스트가 나란한 `<ul>` 세 개로 평평해진다.
    listDepth: lists.length,
    // **정규화는 원본 소스로 한다** — 프로젝션으로 하면 `**굵게**` → `굵게` 같은
    // 서식만의 변경이 무변경으로 삼켜진다(렌더 결과는 분명히 다른데).
    norm: normalize(raw),
    line: map ? map[0] : 0,
    endLine: map ? map[1] : 0,
  };
}

/** 매칭용 정규화 — 공백 접기. 프로젝션엔 마커·소프트랩이 애초에 없다. */
export function normalize(s: string): string {
  return String(s).replace(/\s+/g, " ").trim();
}

/**
 * 매칭 키 — 타입·부가정보·정규화 텍스트가 같으면 같은 블록으로 본다.
 *
 * 구분자는 제어문자다. 공백이나 콜론을 쓰면 본문에 같은 글자가 있을 때 서로 다른 블록이
 * 같은 키를 갖는다. 소스에는 **이스케이프 표기로** 둔다 — 생 제어문자를 박으면 grep 같은
 * 도구가 파일을 바이너리로 판단해 침묵한다.
 */
const SEP = "\u0001";

export function blockKey(b: SourceBlock): string {
  return `${b.type}${SEP}${b.info}${SEP}${b.norm}`;
}

/**
 * 블록의 원본 마크다운 조각을 렌더한 HTML.
 *
 * 조각을 **단독 문서로 다시 파싱**하므로 원본의 들여쓰기를 그대로 두면 안 된다.
 * 중첩 리스트 항목(`    - 둘`)은 4칸 이상 들여써져 있어 그대로 파싱하면
 * 들여쓰기 코드블록이 된다 — 리스트 항목이 `<pre><code>`로 렌더되는 실제 회귀였다.
 *
 * 파서는 계산할 때와 **같은 인스턴스**를 쓴다. 렌더를 호출부로 미루면 파서가 둘로 갈릴
 * 여지가 생기고, 그러면 좌표계가 어긋나 하이라이트가 밀린다.
 */
export function blockHtml(src: string, b: SourceBlock): string {
  return md.render(sliceSource(src, b));
}

/** 블록의 원본 마크다운 조각(들여쓰기 제거 후). 테스트가 들여다본다. */
export function sliceSource(src: string, b: SourceBlock): string {
  const lines = String(src)
    .split("\n")
    .slice(b.line, b.endLine || b.line + 1);
  return dedentable(b, lines) ? dedent(lines).join("\n") : lines.join("\n");
}

/**
 * 들여쓰기를 벗겨도 되는 블록인가.
 *
 * **들여쓰기 코드블록(4칸)은 그 들여쓰기가 곧 문법이다** — 벗기면 평범한 문단이 된다.
 * 반면 펜스 코드블록은 리스트 안에서 함께 들여써지므로 벗겨야 한다.
 * 둘 다 타입이 `code`라 여기서 여는 줄을 보고 가른다.
 */
function dedentable(b: SourceBlock, lines: string[]): boolean {
  if (b.type !== "code") return true;
  const first = lines.find((l) => l.trim().length);
  return first !== undefined && /^(```|~~~)/.test(first.trim());
}

/** 모든 줄에서 공통 선행 공백을 벗긴다. 빈 줄은 건너뛴다(들여쓰기 폭 계산에서도 제외). */
function dedent(lines: string[]): string[] {
  let min = Infinity;
  for (const line of lines) {
    if (!line.trim().length) continue;
    min = Math.min(min, line.length - line.replace(/^[ \t]+/, "").length);
  }
  if (!Number.isFinite(min) || min === 0) return lines;
  return lines.map((line) => (line.trim().length ? line.slice(min) : line));
}

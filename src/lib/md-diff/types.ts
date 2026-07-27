/**
 * 문서 diff 모델 타입.
 *
 * 좌표계 규약 하나만 기억하면 된다: **모든 오프셋은 "새 문서" 텍스트 기준의 UTF-16 인덱스**다.
 * 삭제된 글자는 새 문서에 자리가 없으므로 길이 대신 "어디에 있었나"(`at`)만 기록한다.
 */

/** 블록 원자 — 사람이 한 덩어리로 읽는 단위. 리스트는 통짜가 아니라 **항목**이 원자다. */
export type BlockType =
  | "heading"
  | "paragraph"
  | "blockquote"
  | "list_item"
  | "code"
  | "hr"
  | "html"
  | "table";

/** 블록이 겪은 일. `same`은 화면에 표시가 없지만 순서를 위해 모델에 남는다. */
export type BlockKind = "same" | "inserted" | "deleted" | "modified" | "moved";

/** 삽입/수정 스팬 — 새 텍스트에서 칠할 구간. */
export interface InsSpan {
  start: number;
  end: number;
}

/** 삭제 조각 — 새 텍스트의 이 위치에 있던 글자들. */
export interface DelSpan {
  at: number;
  text: string;
}

/** 표 한 칸의 변경. 좌표는 렌더된 `<table>`의 행·열 인덱스와 일치한다(헤더가 0행). */
export interface CellSpans {
  row: number;
  col: number;
  ins: InsSpan[];
  del: DelSpan[];
}

/** 파서가 뽑아낸 표 칸 — 매칭 전 원재료. */
export interface TableCell {
  row: number;
  col: number;
  text: string;
}

/** 매칭 전 블록. `core` 내부 표현이며 모델 밖으로 나가지 않는다. */
export interface SourceBlock {
  type: BlockType;
  /**
   * 텍스트 프로젝션 — **렌더된 DOM의 `textContent`와 1:1로 대응한다.**
   * 스팬 오프셋의 좌표계가 이것이므로 마크업 기호(`**`, `` ` ``, `[](...)`)가 들어가면 안 된다.
   */
  text: string;
  /**
   * 원본 인라인 소스 — 마크업 기호를 포함한다. **정체성 판정 전용.**
   * 프로젝션만 보면 `**굵게**` → `굵게` 같은 서식 변경이 무변경으로 삼켜진다.
   */
  raw: string;
  /** 코드펜스 언어, 헤딩 태그 등 "정체성"의 일부. */
  info: string;
  /** 매칭용 정규화(`raw`의 공백 접기) — 소스 랩·리스트 마커 차이를 여기서 흡수한다. */
  norm: string;
  listTag: "ul" | "ol" | null;
  listId: string | null;
  /** 리스트 중첩 깊이(1-based, 리스트 밖은 0). 렌더러가 `<ul>` 중첩을 복원하는 근거다. */
  listDepth: number;
  line: number;
  endLine: number;
  cells?: TableCell[];
}

/** 화면에 그려질 블록 하나. */
export interface DiffBlock {
  kind: BlockKind;
  type: BlockType;
  info: string;
  text: string;
  /**
   * 이 블록만 렌더한 HTML. **계산 단계에서 만든다** — 렌더러가 따로 파싱하면 파서가 둘로
   * 갈려 좌표계가 어긋난다. 덕분에 markdown-it이 Worker 번들에만 들어간다.
   */
  html: string;
  line: number;
  listTag: "ul" | "ol" | null;
  listId: string | null;
  /** 리스트 중첩 깊이(1-based, 리스트 밖은 0). */
  listDepth: number;
  /** `moved`일 때 원래 있던 줄. */
  fromLine?: number;
  /** `modified`일 때 옛 텍스트. */
  oldText?: string;
  ins?: InsSpan[];
  del?: DelSpan[];
  /** 내부를 짚을 수 없어 "통째 변경" 배지로 물러선 경우(표 구조 변경 등). */
  wholeCode?: boolean;
  /** 스팬이 어절이 아니라 **줄** 단위임(코드블록). */
  codeLines?: boolean;
  /** 표의 칸별 변경. */
  cells?: CellSpans[] | null;
}

export interface DocDiffStats {
  inserted: number;
  deleted: number;
  modified: number;
  moved: number;
}

export interface DocDiffModel {
  blocks: DiffBlock[];
  stats: DocDiffStats;
}


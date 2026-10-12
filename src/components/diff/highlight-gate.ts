import type { DiffOutput } from "@/types";

/** 구문 강조를 기본으로 켜는 최대 행 수(렌더되는 행, context 포함). */
export const HIGHLIGHT_ROW_LIMIT = 2000;
/** 옛 쪽 + 새 쪽 원문 글자 수가 이를 넘으면 강조를 기본 off로 둔다(`initSyntax`는 원문 전체를 파싱한다). */
export const HIGHLIGHT_CHAR_LIMIT = 1_000_000;
/** 한 줄이 이보다 길면(압축한 JS 등) 행 수가 적어도 강조를 기본 off로 둔다. */
export const HIGHLIGHT_LINE_LIMIT = 10_000;

export type HighlightOff = "rows" | "size";

/**
 * 구문 강조를 기본으로 끄는 이유. 켜도 되면 null.
 * 행 수만 보면 5 MB 한 줄짜리 파일(행 2개)이 통과해 `initSyntax`가 메인 스레드를 9초 막는다.
 */
export function highlightOffReason(diff: DiffOutput, rows: number): HighlightOff | null {
  if (rows > HIGHLIGHT_ROW_LIMIT) return "rows";
  if (diff.oldContent.length + diff.newContent.length > HIGHLIGHT_CHAR_LIMIT) return "size";
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      if (line.content.length > HIGHLIGHT_LINE_LIMIT) return "size";
    }
  }
  return null;
}

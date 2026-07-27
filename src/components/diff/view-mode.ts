/** Diff 보기 모드. `document`는 렌더된 마크다운 위에 변경을 칠하는 보기다. */
export type DiffViewMode = "unified" | "split" | "document";

const MARKDOWN_EXT = new Set(["md", "markdown", "mdown", "mkd"]);

export function isMarkdownPath(filePath: string): boolean {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return MARKDOWN_EXT.has(ext);
}

/**
 * 이 파일에서 고를 수 있는 모드들. 통합·나란히는 **항상** 가능하다(모든 것의 폴백).
 *
 * 문서 모드가 불가능한 파일에서는 세그먼트 자체가 2개로 줄어든다 —
 * 눌러도 안 되는 버튼을 회색으로 남겨 두면 "왜 안 되지"를 매번 묻게 된다.
 */
export function availableModes(filePath: string, binary: boolean): DiffViewMode[] {
  const modes: DiffViewMode[] = ["unified", "split"];
  if (!binary && isMarkdownPath(filePath)) modes.push("document");
  return modes;
}

/** 처음 열 때의 모드 — 마크다운이면 문서 보기가 기본이다. */
export function defaultMode(filePath: string | undefined, binary: boolean): DiffViewMode {
  if (!filePath) return "unified";
  return availableModes(filePath, binary).includes("document") ? "document" : "unified";
}

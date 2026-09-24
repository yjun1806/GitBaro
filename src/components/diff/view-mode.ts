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

/**
 * 처음 열 때의 모드 — 마크다운이면 문서 보기가 기본이고, 나머지는 사용자가 마지막으로
 * 고른 줄 보기(통합/나란히)를 따른다.
 */
export function defaultMode(
  filePath: string | undefined,
  binary: boolean,
  lineMode: "unified" | "split" = "unified",
): DiffViewMode {
  if (!filePath) return lineMode;
  return availableModes(filePath, binary).includes("document") ? "document" : lineMode;
}

/**
 * 보기 상태(모드·하이라이팅 강제·스크롤)를 초기화할 기준. 같은 파일이 디스크 변경으로
 * 다시 조회되면 diff 객체는 새로 오지만 이 값은 그대로라 사용자가 보던 상태가 유지된다.
 */
export function diffResetKey(filePath: string | undefined, staged: boolean, binary: boolean): string {
  return [filePath ?? "", staged ? "staged" : "worktree", binary ? "bin" : "text"].join("\u0000");
}

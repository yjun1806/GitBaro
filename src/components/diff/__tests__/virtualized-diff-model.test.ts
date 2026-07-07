import { describe, it, expect } from "vitest";
import { DiffFile, DiffLineType } from "@git-diff-view/core";
import { buildDiffLayout } from "../VirtualizedDiffView";

// VirtualizedDiffView가 의존하는 DiffFile의 행 모델 계약을 검증한다.
// 렌더러는 0..unifiedLineLength(및 splitLineLength)를 인덱스로 순회하며
// getUnifiedLine / getSplitLeftLine / getSplitRightLine로 행을 그리므로,
// (1) hunk 헤더가 인라인 행으로 포함되는지, (2) 줄번호가 올바른지가 핵심 전제다.

const OLD = "line1\nline2\nline3\n";
const NEW = "line1\nline2 changed\nline3\nline4\n";
const UNIFIED = [
  "--- a/f.txt",
  "+++ b/f.txt",
  "@@ -1,3 +1,4 @@",
  " line1",
  "-line2",
  "+line2 changed",
  " line3",
  "+line4",
].join("\n");

function buildFile() {
  const file = new DiffFile("f.txt", OLD, "f.txt", NEW, [UNIFIED], "text", "text");
  file.initRaw();
  return file;
}

describe("DiffFile unified row model", () => {
  it("content 라인만 반환하고, hunk 헤더는 첫 라인의 prevHunkLine으로 노출된다", () => {
    const file = buildFile();
    file.buildUnifiedDiffLines();
    expect(file.unifiedLineLength).toBeGreaterThan(0);

    const types: (DiffLineType | undefined)[] = [];
    for (let i = 0; i < file.unifiedLineLength; i++) {
      types.push(file.getUnifiedLine(i).diff?.type);
    }
    // content 라인만 — 인라인 Hunk 행은 없다(렌더러가 prevHunkLine으로 헤더를 삽입).
    expect(types).not.toContain(DiffLineType.Hunk);
    expect(types).toContain(DiffLineType.Add);
    expect(types).toContain(DiffLineType.Delete);

    // 첫 라인에 hunk 헤더 정보(@@ ... @@)가 붙어 있어야 한다 — 렌더러가 이걸 삽입한다.
    const firstHunk = file.getUnifiedLine(0).diff?.prevHunkLine;
    expect(firstHunk).toBeTruthy();
    const info = firstHunk?.unifiedInfo as { plainText?: string } | undefined;
    expect(info?.plainText).toContain("@@");
  });

  it("줄번호: 삭제행은 old만, 추가행은 new만 가진다", () => {
    const file = buildFile();
    file.buildUnifiedDiffLines();

    let sawDelete = false;
    let sawAdd = false;
    for (let i = 0; i < file.unifiedLineLength; i++) {
      const line = file.getUnifiedLine(i);
      if (line.diff?.type === DiffLineType.Delete) {
        sawDelete = true;
        expect(line.oldLineNumber).toBeTruthy();
      }
      if (line.diff?.type === DiffLineType.Add) {
        sawAdd = true;
        expect(line.newLineNumber).toBeTruthy();
      }
    }
    expect(sawDelete).toBe(true);
    expect(sawAdd).toBe(true);
  });
});

// 여러 hunk를 가진 diff — 헤더 삽입 개수 검증용.
const OLD2 = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\n";
const NEW2 = "a\nB\nc\nd\ne\nf\ng\nh\ni\nJ\nk\n";
const UNIFIED2 = [
  "--- a/f",
  "+++ b/f",
  "@@ -1,3 +1,3 @@",
  " a",
  "-b",
  "+B",
  " c",
  "@@ -9,3 +9,3 @@",
  " i",
  "-j",
  "+J",
  " k",
].join("\n");

describe("buildDiffLayout", () => {
  it("각 hunk 앞에 헤더 행을 삽입한다 (2 hunk → 헤더 2개)", () => {
    const file = new DiffFile("f", OLD2, "f", NEW2, [UNIFIED2], "text", "text");
    file.initRaw();
    file.buildUnifiedDiffLines();

    const { rows } = buildDiffLayout(file, false);
    const hunkRows = rows.filter((r) => r.kind === "hunk");
    const lineRows = rows.filter((r) => r.kind === "line");

    expect(hunkRows).toHaveLength(2);
    expect(lineRows).toHaveLength(file.unifiedLineLength);
    // 첫 행은 hunk 헤더, 그 텍스트는 @@ 를 포함한다.
    expect(rows[0].kind).toBe("hunk");
    expect(rows[0].kind === "hunk" && rows[0].text).toContain("@@");
  });

  it("줄번호·문자폭 추정치를 라인 데이터에서 산출한다", () => {
    const file = new DiffFile("f", OLD2, "f", NEW2, [UNIFIED2], "text", "text");
    file.initRaw();
    file.buildUnifiedDiffLines();

    const layout = buildDiffLayout(file, false);
    expect(layout.maxLineNo).toBe(11); // 11줄 파일
    expect(layout.maxUnifiedChars).toBeGreaterThan(0);
  });

  it("split 모드에서도 헤더 행을 삽입하고 라인 행 수가 splitLineLength와 같다", () => {
    const file = new DiffFile("f", OLD2, "f", NEW2, [UNIFIED2], "text", "text");
    file.initRaw();
    file.buildSplitDiffLines();

    const { rows } = buildDiffLayout(file, true);
    expect(rows.filter((r) => r.kind === "hunk")).toHaveLength(2);
    expect(rows.filter((r) => r.kind === "line")).toHaveLength(file.splitLineLength);
  });
});

describe("DiffFile split row model", () => {
  it("좌/우 라인을 인덱스로 접근할 수 있고 길이가 양수다", () => {
    const file = buildFile();
    file.buildSplitDiffLines();
    expect(file.splitLineLength).toBeGreaterThan(0);

    // 각 인덱스에서 좌/우 라인 접근이 예외 없이 동작한다.
    for (let i = 0; i < file.splitLineLength; i++) {
      expect(() => file.getSplitLeftLine(i)).not.toThrow();
      expect(() => file.getSplitRightLine(i)).not.toThrow();
    }

    // 추가된 라인(line4)은 우측에만 존재(좌측은 빈 칸)해야 한다.
    let sawRightOnly = false;
    for (let i = 0; i < file.splitLineLength; i++) {
      const left = file.getSplitLeftLine(i);
      const right = file.getSplitRightLine(i);
      if (right.diff?.type === DiffLineType.Add && left.lineNumber == null) {
        sawRightOnly = true;
      }
    }
    expect(sawRightOnly).toBe(true);
  });
});

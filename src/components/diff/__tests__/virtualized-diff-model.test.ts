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
    // 접힌 라인은 행에서 빠진다 — 11줄 파일이지만 두 hunk가 덮는 8줄만 나온다.
    expect(lineRows).toHaveLength(8);
    expect(lineRows.length).toBeLessThan(file.unifiedLineLength);
    // 첫 행은 hunk 헤더, 그 텍스트는 @@ 를 포함한다.
    expect(rows[0].kind).toBe("hunk");
    expect(rows[0].kind === "hunk" && rows[0].text).toContain("@@");
  });

  it("접힌 줄 수를 hunk 행에 실어 펼치기 버튼의 근거를 준다", () => {
    const file = new DiffFile("f", OLD2, "f", NEW2, [UNIFIED2], "text", "text");
    file.initRaw();
    file.buildUnifiedDiffLines();

    const hunks = buildDiffLayout(file, false).rows.filter((r) => r.kind === "hunk");
    // 두 hunk 사이(d~h 5줄)가 접혀 있다. 문서 시작·끝은 hunk가 덮으므로 접힘이 없다.
    expect(hunks.map((h) => h.kind === "hunk" && h.hiddenCount)).toEqual([0, 5]);
  });

  it("펼치면 그만큼 행이 늘고 접힌 줄 수가 0이 된다", () => {
    const file = new DiffFile("f", OLD2, "f", NEW2, [UNIFIED2], "text", "text");
    file.initRaw();
    file.buildUnifiedDiffLines();
    expect(file.getExpandEnabled()).toBe(true);

    const before = buildDiffLayout(file, false);
    const target = before.rows.find((r) => r.kind === "hunk" && r.hiddenCount > 0);
    expect(target?.kind === "hunk" && target.index).toBeGreaterThan(0);

    if (target?.kind !== "hunk") throw new Error("접힌 hunk가 없다");
    file.onUnifiedHunkExpand("all", target.index);

    const after = buildDiffLayout(file, false);
    const lines = after.rows.filter((r) => r.kind === "line");
    // 접힌 게 없으면 라이브러리가 가진 행 전부가 나온다(unified는 삭제·추가가 따로 세어진다).
    expect(lines).toHaveLength(file.unifiedLineLength);
    expect(lines.length).toBeGreaterThan(before.rows.filter((r) => r.kind === "line").length);
    expect(after.rows.filter((r) => r.kind === "hunk" && r.hiddenCount > 0)).toHaveLength(0);
  });

  it("원문이 없으면 펼칠 수 없다", () => {
    // 접힘 자체는 원문이 있어야 성립한다 — 없으면 hunk가 곧 전부다.
    const file = new DiffFile("f", "", "f", "", [UNIFIED2], "text", "text");
    file.initRaw();
    file.buildUnifiedDiffLines();
    expect(file.getExpandEnabled()).toBe(false);
    expect(buildDiffLayout(file, false).rows.filter((r) => r.kind === "line")).toHaveLength(8);
  });

  it("줄번호 칸 폭의 근거가 되는 최대 줄번호를 산출한다", () => {
    // 본문 폭은 재지 않는다 — 긴 줄은 가로로 흐르지 않고 접힌다.
    const file = new DiffFile("f", OLD2, "f", NEW2, [UNIFIED2], "text", "text");
    file.initRaw();
    file.buildUnifiedDiffLines();

    const layout = buildDiffLayout(file, false);
    expect(layout.maxLineNo).toBe(11); // 11줄 파일
  });

  it("변경 블록: 연속 삭제+추가는 mix 한 블록, context로 끊긴 추가는 별도 add 블록", () => {
    const file = buildFile(); // -line2/+line2 changed, (context), +line4
    file.buildUnifiedDiffLines();

    const { changeBlocks, rows } = buildDiffLayout(file, false);
    expect(changeBlocks).toHaveLength(2);
    expect(changeBlocks[0].kind).toBe("mix"); // 삭제 다음 추가가 연속
    expect(changeBlocks[1].kind).toBe("add"); // context 뒤 순수 추가
    for (const b of changeBlocks) {
      expect(b.end).toBeGreaterThanOrEqual(b.start);
      expect(rows[b.start].kind).toBe("line");
      expect(rows[b.end].kind).toBe("line");
    }
  });

  it("변경 블록: hunk 경계가 변경 run을 분리한다 (2 hunk → 블록 2개)", () => {
    const file = new DiffFile("f", OLD2, "f", NEW2, [UNIFIED2], "text", "text");
    file.initRaw();
    file.buildUnifiedDiffLines();

    const { changeBlocks } = buildDiffLayout(file, false);
    expect(changeBlocks).toHaveLength(2);
    expect(changeBlocks[0].kind).toBe("mix");
    expect(changeBlocks[1].kind).toBe("mix");
  });

  it("split 모드에서도 헤더 행을 삽입하고 접힌 줄은 뺀다", () => {
    const file = new DiffFile("f", OLD2, "f", NEW2, [UNIFIED2], "text", "text");
    file.initRaw();
    file.buildSplitDiffLines();

    const { rows } = buildDiffLayout(file, true);
    expect(rows.filter((r) => r.kind === "hunk")).toHaveLength(2);
    const lines = rows.filter((r) => r.kind === "line");
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThan(file.splitLineLength);
  });

  it("split 모드에서도 펼치면 전체가 나온다", () => {
    const file = new DiffFile("f", OLD2, "f", NEW2, [UNIFIED2], "text", "text");
    file.initRaw();
    file.buildSplitDiffLines();

    const target = buildDiffLayout(file, true).rows.find(
      (r) => r.kind === "hunk" && r.hiddenCount > 0,
    );
    if (target?.kind !== "hunk") throw new Error("접힌 hunk가 없다");
    file.onSplitHunkExpand("all", target.index);

    const after = buildDiffLayout(file, true).rows.filter((r) => r.kind === "line");
    expect(after).toHaveLength(file.splitLineLength);
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

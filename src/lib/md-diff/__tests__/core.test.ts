import { describe, it, expect } from "vitest";
import { computeDocDiff } from "../core";
import { sliceSource, toBlocks } from "../blocks";
import { similarity } from "../match";
import { segmentsOf } from "../spans";
import type { DiffBlock, InsSpan } from "../types";

/**
 * 문서 diff 코어의 골든 테스트 — muxa(`DocDiffCoreTests.swift`)에서 이식했다.
 *
 * 코어는 DOM을 안 만지므로 순수 함수처럼 검증된다. 비동기도 플레이키도 없다.
 * 임계값(`options.ts`)을 건드릴 일이 생기면 **여기를 먼저** 고쳐라.
 */

const kindsOf = (blocks: DiffBlock[]) => blocks.map((b) => b.kind);
const covered = (spans: InsSpan[] | undefined) =>
  (spans ?? []).reduce((n, s) => n + (s.end - s.start), 0);

describe("1층 — 블록 매칭", () => {
  it("같은 문서는 변경이 없다", () => {
    const src = "# 제목\n\n첫 문단입니다.\n\n둘째 문단입니다.\n";
    const { stats } = computeDocDiff(src, src);
    expect(stats).toEqual({ inserted: 0, deleted: 0, modified: 0, moved: 0 });
  });

  it("문단 추가를 잡는다", () => {
    const { stats } = computeDocDiff("# 제목\n\n첫 문단.\n", "# 제목\n\n첫 문단.\n\n새 문단.\n");
    expect(stats.inserted).toBe(1);
    expect(stats.deleted).toBe(0);
  });

  it("삭제된 문단이 있던 자리에 남는다", () => {
    // 삭제 블록이 목록에서 빠지면 "여기서 뭐가 없어졌다"를 말할 수 없다.
    const { blocks, stats } = computeDocDiff("# 제목\n\nA 문단.\n\nB 문단.\n", "# 제목\n\nB 문단.\n");
    expect(stats.deleted).toBe(1);
    expect(kindsOf(blocks)).toContain("deleted");
  });

  it("소프트랩 변경은 변경이 아니다", () => {
    // 소스 노이즈 흡수 — 렌더 결과가 같으면 무변경이어야 한다.
    const { stats } = computeDocDiff(
      "이 문단은 한 줄로 되어 있습니다.\n",
      "이 문단은\n한 줄로\n되어 있습니다.\n",
    );
    expect(stats).toEqual({ inserted: 0, deleted: 0, modified: 0, moved: 0 });
  });

  it("리스트 마커 교체는 변경이 아니다", () => {
    const { stats } = computeDocDiff("- 하나\n- 둘\n", "* 하나\n* 둘\n");
    expect(stats).toEqual({ inserted: 0, deleted: 0, modified: 0, moved: 0 });
  });

  it("리스트 항목 추가는 그 항목만 표시한다", () => {
    // 항목 하나 추가가 리스트 전체 교체로 보이면 안 된다.
    const { stats } = computeDocDiff("- 하나\n- 둘\n", "- 하나\n- 하나 반\n- 둘\n");
    expect(stats.inserted).toBe(1);
    expect(stats.deleted).toBe(0);
    expect(stats.modified).toBe(0);
  });
});

describe("텍스트 프로젝션 — 오프셋 좌표계의 전제", () => {
  it("블록 텍스트에 마크업 기호가 섞이지 않는다", () => {
    // `text`는 렌더된 DOM의 textContent와 1:1이어야 한다. `**`나 백틱이 섞이면
    // 그만큼 오프셋이 밀려 엉뚱한 글자가 칠해진다.
    const src = "**굵게** 와 `코드` 와 [링크](http://a.b) 끝\n";
    const { blocks } = computeDocDiff(src, src);
    const para = blocks.find((b) => b.type === "paragraph");
    expect(para?.text).toBe("굵게 와 코드 와 링크 끝");
  });

  it("이미지는 텍스트 0자다", () => {
    // `alt`는 속성이라 DOM 텍스트 노드로 안 나온다 — 세면 오프셋이 밀린다.
    const src = "앞 ![대체문구](x.png) 뒤\n";
    const para = computeDocDiff(src, src).blocks.find((b) => b.type === "paragraph");
    expect(para?.text).toBe("앞  뒤");
  });

  it("서식만 바뀌어도 무변경으로 삼키지 않는다", () => {
    // 프로젝션만 보면 `**굵게**`와 `굵게`가 같아진다 — 정체성 판정은 원본 소스로 한다.
    const kinds = kindsOf(computeDocDiff("굵게 표시.\n", "**굵게** 표시.\n").blocks);
    expect(kinds.every((k) => k === "same")).toBe(false);
  });
});

describe("2·3층 — 한국어", () => {
  it("조사만 바뀌면 조사만 강조한다", () => {
    // 핵심 케이스 — "문단을" 통째가 아니라 "을"만 칠해져야 한다.
    const { blocks } = computeDocDiff("이 문단을 수정합니다.\n", "이 문단이 수정합니다.\n");
    const mod = blocks.find((b) => b.kind === "modified");
    expect(mod).toBeDefined();
    expect(mod?.ins?.length).toBeGreaterThan(0);
    expect(covered(mod?.ins)).toBeLessThanOrEqual(2);
  });

  it("어미가 바뀌어도 공통부는 남는다", () => {
    const { blocks } = computeDocDiff("문서를 수정했습니다.\n", "문서를 수정되었습니다.\n");
    const mod = blocks.find((b) => b.kind === "modified");
    expect(covered(mod?.ins)).toBeLessThan(8);
  });

  it("닮지 않은 단어는 문자 세분 임계를 못 넘는다", () => {
    expect(similarity("고양이", "강아지")).toBeLessThan(0.5);
  });

  it("조사·어미 교체는 임계를 넘는다", () => {
    expect(similarity("문단을", "문단이")).toBeGreaterThanOrEqual(0.5);
    expect(similarity("수정했습니다", "수정되었습니다")).toBeGreaterThanOrEqual(0.5);
  });

  it("한국어 어절 분절이 동작한다", () => {
    // 2층의 전제 — 조사가 어절에 붙어 나와야 한다.
    expect(segmentsOf("문단을 수정했습니다")).toEqual(["문단을", " ", "수정했습니다"]);
  });
});

describe("과분절 방어 — 단어 수프 방지", () => {
  it("다시 쓴 긴 문단은 통째 교체가 된다", () => {
    const a =
      "저장은 recruit_until 컬럼에 기록하고 closed_at 타임스탬프로 수동 마감 시각을 남기며 처리 창 배제 판정에 쓴다. 별도 reason 컬럼은 두지 않는다.\n";
    const b =
      "기록은 완전히 다른 방식으로 바뀌었다. 유일한 마감은 존재하지 않으며 capacity 또는 manual 중 하나를 골라 필요할 때만 별도로 남긴다.\n";
    const kinds = kindsOf(computeDocDiff(a, b).blocks);
    expect(kinds).not.toContain("modified");
    expect(kinds).toContain("deleted");
    expect(kinds).toContain("inserted");
  });

  it("짧은 문장은 강등하지 않는다", () => {
    // 단어 하나만 바꿔도 비율이 쉽게 50%를 넘지만, 그건 안 읽히는 화면이 아니다.
    const kinds = kindsOf(computeDocDiff("안녕 반가워\n", "안녕 반갑다\n").blocks);
    expect(kinds).toContain("modified");
  });

  it("긴 문단의 작은 수정은 인라인으로 남는다", () => {
    const base = "이 문장은 충분히 길어서 비율 판정이 적용됩니다. ".repeat(4);
    const kinds = kindsOf(
      computeDocDiff(`${base}끝맺음을 수정합니다.\n`, `${base}끝맺음을 수정했습니다.\n`).blocks,
    );
    expect(kinds).toContain("modified");
  });
});

describe("원자 블록 — 코드·표·리스트", () => {
  it("코드블록은 어절이 아니라 줄 단위로 diff한다", () => {
    const { blocks } = computeDocDiff("```swift\nlet x = 1\n```\n", "```swift\nlet x = 2\n```\n");
    const mod = blocks.find((b) => b.kind === "modified");
    expect(mod?.codeLines).toBe(true);
    expect(mod?.ins?.length).toBeGreaterThan(0);
  });

  it("코드블록은 바뀐 줄만 짚는다", () => {
    const a = "```swift\nlet x = 1\nlet y = 2\nprint(x)\n```\n";
    const b = "```swift\nlet x = 1\nlet y = 99\nprint(x)\n```\n";
    const code = computeDocDiff(a, b).blocks.find((x) => x.type === "code");
    expect(code?.kind).toBe("modified");
    expect(code?.codeLines).toBe(true);
    expect(code?.wholeCode).not.toBe(true);
    expect(covered(code?.ins)).toBeLessThan((code?.text ?? "").length);
  });

  it("표는 바뀐 칸만 좌표로 짚는다", () => {
    const a = "| 항목 | 값 |\n|---|---|\n| 하나 | 1 |\n| 둘 | 2 |\n";
    const b = "| 항목 | 값 |\n|---|---|\n| 하나 | 1 |\n| 둘 | 22 |\n";
    const table = computeDocDiff(a, b).blocks.find((x) => x.type === "table");
    expect(table?.cells).toHaveLength(1);
    // 헤더가 0행이므로 바뀐 칸은 2행 1열.
    expect(table?.cells?.[0]).toMatchObject({ row: 2, col: 1 });
  });

  it("표 구조가 바뀌면 칸을 지어내지 않고 통짜로 물러선다", () => {
    const a = "| A | B |\n|---|---|\n| 1 | 2 |\n";
    const b = "| A | B | C |\n|---|---|---|\n| 1 | 2 | 3 |\n";
    const table = computeDocDiff(a, b).blocks.find((x) => x.type === "table");
    if (table?.kind === "modified") {
      expect(table.wholeCode).toBe(true);
      expect(table.cells).toBeNull();
    }
  });

  it("코드펜스 언어 태그는 정체성의 일부다", () => {
    // 렌더 결과에는 언어가 클래스로만 남아 눈에 안 띄므로 "무변경"으로 삼키면 안 된다.
    const kinds = kindsOf(computeDocDiff("```js\nx\n```\n", "```ts\nx\n```\n").blocks);
    expect(kinds.every((k) => k === "same")).toBe(false);
  });

  it("리스트 항목이 리스트 소속 정보를 싣는다", () => {
    // 없으면 렌더러가 항목마다 `<ul>`을 새로 만들어 리스트가 쪼개진다.
    const items = computeDocDiff("- 하나\n- 둘\n", "- 하나\n- 하나 반\n- 둘\n").blocks.filter(
      (b) => b.listId !== null,
    );
    expect(items).toHaveLength(3);
    expect(new Set(items.map((b) => b.listId)).size).toBe(1);
    expect(items.every((b) => b.listTag === "ul")).toBe(true);
  });

  it("순서 리스트는 ol 태그를 싣는다", () => {
    const items = computeDocDiff("1. 하나\n2. 둘\n", "1. 하나\n2. 하나 반\n3. 둘\n").blocks.filter(
      (b) => b.listId !== null,
    );
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((b) => b.listTag === "ol")).toBe(true);
  });

  it("떨어진 두 리스트는 id가 갈린다", () => {
    const src = "- A\n\n문단.\n\n- B\n";
    const ids = new Set(
      computeDocDiff(src, src)
        .blocks.map((b) => b.listId)
        .filter((id): id is string => id !== null),
    );
    expect(ids.size).toBe(2);
  });

  it("인용 안 문단은 한 번만 센다", () => {
    // 바깥 인용까지 세면 같은 내용이 두 번 잡힌다.
    const { stats } = computeDocDiff("> 인용 문단.\n", "> 인용 문단 수정.\n");
    expect(stats).toEqual({ inserted: 0, deleted: 0, modified: 1, moved: 0 });
  });

  it("표는 블록 하나다", () => {
    // 행 단위로 자르면 `| 하나 | 1 |`이 헤더·구분선 없이 남아 생 파이프 텍스트로 렌더된다.
    const a = "| 항목 | 값 |\n|---|---|\n| 하나 | 1 |\n| 둘 | 2 |\n";
    const b = "| 항목 | 값 |\n|---|---|\n| 하나 | 1 |\n| 둘 | 22 |\n";
    const tables = computeDocDiff(a, b).blocks.filter((x) => x.type === "table");
    expect(tables).toHaveLength(1);
    expect(tables[0].kind).toBe("modified");
    // 표 전체 오프셋으로 칠하면 셀 경계를 넘어 엉뚱한 칸이 칠해진다.
    expect(tables[0].ins).toEqual([]);
    expect(tables[0].cells?.length).toBeGreaterThan(0);
  });

  it("표에 행이 추가돼도 블록 하나다", () => {
    const a = "| A | B |\n|---|---|\n| 1 | 2 |\n";
    const b = "| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n";
    expect(computeDocDiff(a, b).blocks.filter((x) => x.type === "table")).toHaveLength(1);
  });
});

describe("중첩 리스트 — 조각을 단독 문서로 다시 파싱하는 데 따르는 함정", () => {
  const sourcesOf = (src: string) => toBlocks(src).map((b) => sliceSource(src, b));

  it("중첩 항목 조각에서 들여쓰기를 벗긴다", () => {
    // 벗기지 않으면 4칸 이상 들여쓴 조각이 '들여쓰기 코드블록'으로 파싱된다.
    expect(sourcesOf("- 하나\n    - 둘\n")).toEqual(["- 하나", "- 둘"]);
    expect(sourcesOf("- 하나\n  - 둘\n    - 셋\n")).toEqual(["- 하나", "- 둘", "- 셋"]);
  });

  it("들여쓰기 코드블록의 들여쓰기는 벗기지 않는다", () => {
    // 4칸 들여쓰기가 곧 문법이다 — 벗기면 평범한 문단이 된다.
    const src = "문단.\n\n    code line\n";
    expect(sourcesOf(src)).toContain("    code line");
  });

  it("리스트 안 펜스 코드블록은 들여쓰기를 벗긴다", () => {
    const src = "- 항목\n\n  ```ts\n  const x = 1;\n  ```\n";
    expect(sourcesOf(src)).toContain("```ts\nconst x = 1;\n```");
  });

  it("여러 줄 블록은 공통 들여쓰기만 벗겨 상대 들여쓰기를 지킨다", () => {
    const src = "- 하나\n    - 둘 이어지는\n      내용\n";
    expect(sourcesOf(src)).toContain("- 둘 이어지는\n  내용");
  });

  it("중첩 깊이를 블록에 싣는다", () => {
    // 없으면 렌더러가 중첩을 복원하지 못해 나란한 `<ul>` 세 개로 평평해진다.
    const { blocks } = computeDocDiff("- 하나\n  - 둘\n    - 셋\n", "- 하나\n  - 둘\n    - 셋\n");
    expect(blocks.map((b) => b.listDepth)).toEqual([1, 2, 3]);
    expect(new Set(blocks.map((b) => b.listId)).size).toBe(3);
  });
});

describe("빈 문서 — 생성·삭제", () => {
  it("생성은 전부 삽입이다", () => {
    const { stats } = computeDocDiff("", "# 새 문서\n\n내용.\n");
    expect(stats.deleted).toBe(0);
    expect(stats.inserted).toBeGreaterThan(0);
  });

  it("삭제는 전부 삭제다", () => {
    const { stats } = computeDocDiff("# 옛 문서\n\n내용.\n", "");
    expect(stats.inserted).toBe(0);
    expect(stats.deleted).toBeGreaterThan(0);
  });

  it("빈 문서끼리는 무변경이다", () => {
    expect(computeDocDiff("", "").stats).toEqual({
      inserted: 0,
      deleted: 0,
      modified: 0,
      moved: 0,
    });
  });
});

describe("유니코드 안전성 — 오프셋 불변식의 전제", () => {
  it("이모지가 오프셋을 깨뜨리지 않는다", () => {
    // 이모지는 UTF-16 서로게이트 쌍이다 — 오프셋이 어긋나면 하이라이트가 밀린다.
    const { blocks } = computeDocDiff("안녕 🎉 반가워\n", "안녕 🎉 반갑다\n");
    const mod = blocks.find((b) => b.kind === "modified");
    expect(mod).toBeDefined();
    for (const span of mod?.ins ?? []) {
      expect(span.end).toBeLessThanOrEqual((mod?.text ?? "").length);
    }
  });
});

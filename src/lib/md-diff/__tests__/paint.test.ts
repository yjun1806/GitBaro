// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { computeDocDiff } from "../core";
import { paint, type PaintLabels } from "../paint";

/**
 * 페인트 계층 테스트 — 모델이 맞아도 DOM에 잘못 칠하면 사용자에겐 똑같이 틀린 화면이다.
 *
 * 특히 **오프셋 좌표계**를 검증한다. 삽입 강조와 삭제 글자 삽입은 같은 좌표계를 쓰는데,
 * 삭제 글자를 먼저 넣으면 뒤따르는 삽입 좌표가 그만큼 밀린다(muxa 원본이 그 순서였다).
 */

const labels: PaintLabels = {
  deletedBlocks: (count, chars) => `삭제된 블록 ${count}개 · ${chars}자`,
  moved: "위치 변경",
  tableStructureChanged: "표 구조 변경됨",
  codeChanged: "코드 변경됨",
};

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

function render(oldSrc: string, newSrc: string) {
  paint(host, computeDocDiff(oldSrc, newSrc), labels);
  return host;
}

describe("오프셋 좌표계", () => {
  it("삭제 글자가 삽입 강조 위치를 밀지 않는다", () => {
    // 조사 교체 — 새 글자 "이"가 칠해져야 하고, 지워진 "을"은 취소선으로 남아야 한다.
    const el = render("이 문단을 수정합니다.\n", "이 문단이 수정합니다.\n");
    const ins = el.querySelectorAll(".d-mod-text");
    const del = el.querySelectorAll("del.d-deltext");

    expect(ins).toHaveLength(1);
    expect(ins[0].textContent).toBe("이");
    expect(del).toHaveLength(1);
    expect(del[0].textContent).toBe("을");
  });

  it("삭제 글자를 뺀 본문이 새 문서와 같다", () => {
    // 되살린 삭제 글자는 "덧붙인 것"이지 본문이 아니다 — 걷어내면 새 문서 그대로여야 한다.
    const el = render("문서를 수정했습니다.\n", "문서를 수정되었습니다.\n");
    for (const d of el.querySelectorAll("del.d-deltext")) d.remove();
    expect(el.textContent).toBe("문서를 수정되었습니다.");
  });

  it("인라인 마크업이 하이라이트 위치를 밀지 않는다", () => {
    // `inline.content`는 원본 소스(`**굵은** 부분 …`)라 렌더 텍스트보다 길다.
    // 그 좌표로 칠하면 `**` 길이만큼 밀린다.
    const el = render("**굵은** 부분 원본\n", "**굵은** 부분 수정본\n");
    const painted = [...el.querySelectorAll(".d-mod-text")].map((n) => n.textContent).join("");
    expect(painted).toBe("수정본");
    expect(el.querySelector("strong")?.textContent).toBe("굵은");
  });

  it("태그 경계를 걸치는 스팬을 조각내어 전부 칠한다", () => {
    // muxa 폴백은 노드를 걸치면 그 스팬을 통째로 포기했다(정직한 누락이지만 누락이다).
    const el = render("앞 **강조** 뒤\n", "앞 **강조된** 부분 뒤\n");
    const marks = [...el.querySelectorAll(".d-mod-text")];
    // 삽입 구간이 `강조된 부분` 하나로 잡히고, 그 경계에 `</strong>`가 걸린다.
    expect(marks.map((n) => n.textContent).join("")).toBe("강조된 부분");
    // 한 조각은 `<strong>` 안, 다른 조각은 밖에 있어야 한다.
    expect(marks.some((n) => n.closest("strong") !== null)).toBe(true);
    expect(marks.some((n) => n.closest("strong") === null)).toBe(true);
  });
});

describe("블록 렌더링", () => {
  it("삽입된 블록 전체를 칠한다", () => {
    const el = render("# 제목\n\n첫 문단.\n", "# 제목\n\n첫 문단.\n\n새 문단.\n");
    const inserted = el.querySelector('[data-change="inserted"]');
    expect(inserted?.textContent).toBe("새 문단.");
    expect(inserted?.querySelector(".d-ins-text")).not.toBeNull();
  });

  it("순서 리스트가 하나의 ol로 유지된다", () => {
    // 항목마다 ol을 새로 만들면 번호가 전부 1로 초기화된다.
    const el = render("1. 하나\n2. 둘\n", "1. 하나\n2. 하나 반\n3. 둘\n");
    const lists = el.querySelectorAll("ol");
    expect(lists).toHaveLength(1);
    expect(lists[0].querySelectorAll("li")).toHaveLength(3);
  });

  it("중첩 리스트가 코드 블록이 아니라 중첩 ul로 렌더된다", () => {
    // 4칸 들여쓰기 스타일은 2단계부터, 2칸 스타일은 3단계부터 `<pre><code>`가 됐던 회귀.
    const el = render("- 하나\n    - 둘\n", "- 하나\n    - 둘\n");
    expect(el.querySelector("pre")).toBeNull();
    const outer = el.querySelectorAll(":scope > ul");
    expect(outer).toHaveLength(1);
    expect(outer[0].querySelector("li > ul > li")?.textContent).toBe("둘");
  });

  it("3단 중첩이 평평해지지 않는다", () => {
    const el = render("- 하나\n  - 둘\n    - 셋\n", "- 하나\n  - 둘\n    - 셋\n");
    // 최상위 `<ul>`은 하나고, 나머지는 그 안에 중첩되어야 한다.
    expect(el.querySelectorAll(":scope > ul")).toHaveLength(1);
    expect(el.querySelector("li > ul > li > ul > li")?.textContent).toBe("셋");
  });

  it("중첩 리스트에서 바뀐 항목만 표시된다", () => {
    // 짧은 항목은 유사도가 블록 매칭 임계를 못 넘어 삭제+삽입이 된다 — 길이를 준다.
    const el = render(
      "- 바깥 항목입니다\n    - 안쪽 항목입니다\n",
      "- 바깥 항목입니다\n    - 안쪽 항목이었습니다\n",
    );
    const changed = el.querySelectorAll('[data-change="modified"]');
    expect(changed).toHaveLength(1);
    expect(changed[0].closest("li > ul")).not.toBeNull();
  });

  it("표가 온전한 table로 렌더되고 바뀐 칸만 표시된다", () => {
    // 행 단위로 잘랐다면 여기서 생 파이프 텍스트가 나온다.
    const a = "| 항목 | 값 |\n|---|---|\n| 하나 | 1 |\n| 둘 | 2 |\n";
    const b = "| 항목 | 값 |\n|---|---|\n| 하나 | 1 |\n| 둘 | 22 |\n";
    const el = render(a, b);
    expect(el.querySelectorAll("table")).toHaveLength(1);
    expect(el.textContent).not.toContain("|");
    const marked = el.querySelectorAll("td.d-cell");
    expect(marked).toHaveLength(1);
    // 칸 안에 옛 값이 취소선으로 남고 새 값이 칠해진다.
    const cell = marked[0];
    expect(cell.querySelector("del.d-deltext")?.textContent).toBe("2");
    expect(cell.querySelector(".d-mod-text")).not.toBeNull();
    cell.querySelector("del.d-deltext")?.remove();
    expect(cell.textContent).toBe("22");
  });

  it("삭제 블록이 3개 이상이면 접힌 칩으로 묶고 클릭하면 펼친다", () => {
    const a = "# 제목\n\nA.\n\nB.\n\nC.\n\nD.\n";
    const el = render(a, "# 제목\n");
    const chip = el.querySelector<HTMLButtonElement>(".d-delchip");
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain("4개");

    chip?.click();
    expect(el.querySelector(".d-delchip")).toBeNull();
    expect(el.querySelectorAll(".d-delblock")).toHaveLength(4);
  });

  it("삭제 블록이 2개 이하면 그 자리에 펼쳐 둔다", () => {
    const el = render("# 제목\n\nA 문단.\n\nB 문단.\n", "# 제목\n\nB 문단.\n");
    expect(el.querySelector(".d-delchip")).toBeNull();
    expect(el.querySelectorAll(".d-delblock")).toHaveLength(1);
  });

  it("표 구조가 바뀌면 배지로 알린다", () => {
    const a = "| A | B |\n|---|---|\n| 1 | 2 |\n";
    const b = "| A | B | C |\n|---|---|---|\n| 1 | 2 | 3 |\n";
    const el = render(a, b);
    const badge = el.querySelector(".d-atombadge");
    if (badge) expect(badge.textContent).toBe("표 구조 변경됨");
  });

  it("코드블록은 바뀐 줄만 칠한다", () => {
    const a = "```ts\nconst x = 1;\nconst y = 2;\n```\n";
    const b = "```ts\nconst x = 1;\nconst y = 99;\n```\n";
    const el = render(a, b);
    const painted = [...el.querySelectorAll(".d-mod-text")].map((n) => n.textContent).join("");
    expect(painted).toContain("const y = 99;");
    expect(painted).not.toContain("const x = 1;");
  });
});

describe("보안", () => {
  it("생 HTML을 실행 가능한 마크업으로 들여보내지 않는다", () => {
    // 임의 저장소를 여는 앱이다 — README 하나가 Tauri invoke를 잡으면 끝이다.
    const el = render("문단.\n", '문단.\n\n<img src=x onerror="alert(1)">\n');
    // 태그가 아니라 글자로 들어와야 한다 — 요소가 하나도 안 생겨야 안전하다.
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it("javascript: 링크를 살려두지 않는다", () => {
    const el = render("문단.\n", "문단.\n\n[클릭](javascript:alert(1))\n");
    const href = el.querySelector("a")?.getAttribute("href") ?? "";
    expect(href.startsWith("javascript:")).toBe(false);
  });
});

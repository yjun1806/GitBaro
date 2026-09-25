import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// W1-T1: 리뷰 개편 시각 토큰이 :root(라이트)와 .dark(다크) 양쪽에
// 같은 이름 집합으로 정의돼 있는지 검증한다. 값 자체는 CSS 파서 없이
// jsdom에서 확인하기 어려우므로(테마 클래스 전환이 필요), 여기서는
// 소스 텍스트에서 두 블록을 뽑아 커스텀 프로퍼티 이름 집합을 비교한다.

const CSS_PATH = fileURLToPath(new URL("../globals.css", import.meta.url));

/** 최상위 `{ ... }` 블록 하나를 선택자 뒤에서 뽑아낸다 (중첩 없음 전제). */
function extractBlock(css: string, selectorPattern: RegExp): string {
  const match = selectorPattern.exec(css);
  if (!match) {
    throw new Error(`selector not found: ${selectorPattern}`);
  }
  const start = match.index + match[0].length;
  const end = css.indexOf("}", start);
  if (end === -1) {
    throw new Error(`unterminated block for: ${selectorPattern}`);
  }
  return css.slice(start, end);
}

/** 블록 텍스트에서 최상위 커스텀 프로퍼티 이름(`--foo`)을 모두 뽑는다. */
function customPropertyNames(block: string): Set<string> {
  const names = new Set<string>();
  const re = /(^|\n|\s|\{)(--[a-zA-Z0-9-]+)\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    names.add(m[2]);
  }
  return names;
}

// W1-T1 완료 기준이 요구하는 리뷰 개편 토큰 이름들. 두 테마 블록 모두에
// 이 이름들이 있어야 한다.
const REQUIRED_REVIEW_TOKENS = [
  "--frame",
  "--frame-hover",
  "--frame-sel",
  "--canvas",
  "--panel",
  "--float",
  "--line",
  "--line2",
  "--chip",
  "--fg",
  "--fg2",
  "--muted",
  "--faint",
  "--ln",
  "--acc",
  "--acc-hover",
  "--acc-sel",
  "--acc-faint",
  "--acc-line",
  "--live",
  "--live-soft",
  "--status-fail",
  "--shadow",
  "--shadow-sm",
  "--shadow-float",
  "--overlay",
  "--radius-panel",
  "--radius-item",
  "--radius-chip",
  "--radius-pill",
  "--g",
  "--row",
  "--item",
  "--code-lh",
];

describe("리뷰 개편 시각 토큰 (globals.css)", () => {
  const css = readFileSync(CSS_PATH, "utf8");

  // 「Light 테마」 :root 블록과 「Dark 테마」 .dark 블록을 각각 찾는다.
  // 파일 안에는 :root 블록이 여러 개 있으므로, 테마 주석 뒤에 오는
  // 블록을 지정해서 고른다.
  const lightBlock = extractBlock(css, /\/\* ── Light 테마 ── \*\/[\s\S]*?:root\s*\{/);
  const darkBlock = extractBlock(css, /\/\* ── Dark 테마 ── \*\/[\s\S]*?\.dark\s*\{/);

  it("Light 블록에 필요한 리뷰 개편 토큰이 모두 있다", () => {
    const names = customPropertyNames(lightBlock);
    for (const token of REQUIRED_REVIEW_TOKENS) {
      expect(names.has(token), `${token} missing in :root`).toBe(true);
    }
  });

  it("Dark 블록에 필요한 리뷰 개편 토큰이 모두 있다", () => {
    const names = customPropertyNames(darkBlock);
    for (const token of REQUIRED_REVIEW_TOKENS) {
      expect(names.has(token), `${token} missing in .dark`).toBe(true);
    }
  });

  it("Light와 Dark 블록의 리뷰 개편 토큰 이름 집합이 같다", () => {
    const lightNames = [...customPropertyNames(lightBlock)].filter((n) =>
      REQUIRED_REVIEW_TOKENS.includes(n),
    );
    const darkNames = [...customPropertyNames(darkBlock)].filter((n) =>
      REQUIRED_REVIEW_TOKENS.includes(n),
    );
    expect(new Set(darkNames)).toEqual(new Set(lightNames));
  });

  // 위 두 테스트는 REQUIRED_REVIEW_TOKENS로 걸러낸 부분집합만 비교하므로, 두 블록 중
  // 한쪽에만 있는 이름(예: 새 토큰을 한쪽에만 추가)은 걸러지지 않는다. 전체 이름 집합을
  // 그대로 비교해 그런 누락을 잡는다.
  it("Light와 Dark 블록의 커스텀 프로퍼티 전체 이름 집합이 같다", () => {
    expect(customPropertyNames(darkBlock)).toEqual(customPropertyNames(lightBlock));
  });

  it("acc-sel/acc-line은 브랜드 색을 8%/35%로 섞고, acc-faint는 브랜드 색 없이 회색이다", () => {
    expect(lightBlock).toMatch(/--acc-sel:\s*color-mix\(in srgb,\s*var\(--acc\)\s*8%,\s*var\(--panel\)\)/);
    // 섹션 머리 띠 등 강조가 아닌 곳에서 쓰므로 브랜드 색이 새지 않게 한다.
    expect(lightBlock).not.toMatch(/--acc-faint:[^;]*--acc\b/);
    expect(lightBlock).toMatch(/--acc-line:\s*color-mix\(in srgb,\s*var\(--acc\)\s*35%,\s*transparent\)/);
  });

  it("@theme의 --color-muted는 배경 별칭 --muted-bg를 가리킨다 (Tailwind bg-muted 보존)", () => {
    // W1-T1은 새 디자인 토큰 --muted(보조 글자색, #62625f)와 기존 배경 토큰 이름이
    // 겹쳐 기존 쪽을 --muted-bg로 옮겼다. 이 별칭이 --muted(글자색)를 도로 가리키게
    // 되돌아가면 bg-muted를 쓰는 모든 화면(ChangesView 섹션 헤더 등)이 어두운 회색으로
    // 깨진다 — 리뷰 지적.
    const themeBlock = extractBlock(css, /@theme\s*\{/);
    expect(themeBlock).toMatch(/--color-muted:\s*var\(--muted-bg\)/);
  });

  it("Light :root의 --primary는 새 강조색(--acc)을 가리킨다 (README: 버튼·선택·링크·포커스)", () => {
    // 리뷰 지적: --primary가 여전히 --primary-700(Violet)을 가리켜 버튼·링크·포커스
    // 링(--ring은 --primary의 별칭)이 새 강조색 #16181D로 바뀌지 않았었다.
    expect(lightBlock).toMatch(/--primary:\s*var\(--acc\)/);
  });

  it("간격 토큰이 촘촘 밀도 값과 diff 줄 높이 21px를 따른다", () => {
    expect(lightBlock).toMatch(/--g:\s*8px/);
    expect(lightBlock).toMatch(/--row:\s*28px/);
    expect(lightBlock).toMatch(/--item:\s*7px/);
    expect(lightBlock).toMatch(/--code-lh:\s*21px/);
  });

  it("live-soft은 원천 값 rgba(229,112,11,0.16)을 그대로 쓴다 (gen_d.py:229)", () => {
    expect(lightBlock).toMatch(/--live-soft:\s*rgba\(229,\s*112,\s*11,\s*0\.16\)/);
    expect(darkBlock).toMatch(/--live-soft:\s*rgba\(229,\s*112,\s*11,\s*0\.16\)/);
  });

  it("--font-mono는 D2Coding이고 SF Mono/Menlo로 대체한다 (사용자 결정 2026-09-24, README:51)", () => {
    const themeBlock = extractBlock(css, /@theme\s*\{/);
    expect(themeBlock).toMatch(/--font-mono:\s*"D2Coding",\s*ui-monospace,\s*"SF Mono",\s*Menlo,\s*monospace/);
  });

  it("diff 추가·삭제 배경·글자색이 원천 값과 같다", () => {
    expect(lightBlock).toMatch(/--diff-add:\s*#e8f6ee/);
    expect(lightBlock).toMatch(/--diff-add-fg:\s*#145332/);
    expect(lightBlock).toMatch(/--diff-del:\s*#fdeeed/);
    expect(lightBlock).toMatch(/--diff-del-fg:\s*#8e211b/);
  });
});

describe("modal overlay colour", () => {
  it("comes from the --overlay token, not a hard-coded black", () => {
    const root = fileURLToPath(new URL("../../components/", import.meta.url));
    const files = readdirSync(root, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith(".tsx") && !f.includes("__tests__"));
    for (const file of files) {
      expect(readFileSync(`${root}${file}`, "utf8"), file).not.toMatch(/bg-black\/\d+/);
    }
  });
});


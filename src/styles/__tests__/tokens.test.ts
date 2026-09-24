import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
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
  "--canvas",
  "--panel",
  "--line",
  "--line2",
  "--chip",
  "--fg",
  "--fg2",
  "--muted",
  "--faint",
  "--ln",
  "--acc",
  "--acc-sel",
  "--acc-faint",
  "--acc-line",
  "--live",
  "--live-soft",
  "--shadow",
  "--shadow-sm",
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

  it("--font-mono는 Pretendard를 유지한다 (사용자 결정 2026-09-24)", () => {
    const themeBlock = extractBlock(css, /@theme\s*\{/);
    expect(themeBlock).toMatch(/--font-mono:\s*"Pretendard"/);
  });

  it("diff 추가·삭제 배경·글자색이 원천 값과 같다", () => {
    expect(lightBlock).toMatch(/--diff-add:\s*#e8f6ee/);
    expect(lightBlock).toMatch(/--diff-add-fg:\s*#145332/);
    expect(lightBlock).toMatch(/--diff-del:\s*#fdeeed/);
    expect(lightBlock).toMatch(/--diff-del-fg:\s*#8e211b/);
  });
});

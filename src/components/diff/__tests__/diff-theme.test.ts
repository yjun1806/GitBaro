import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// W1-T1 리뷰 지적: diff 추가·삭제 줄의 줄번호 칸이 새 시각 토큰에 없는 진한 녹/빨
// 셀 배경(#c8e6c9/#f5c6cb)에 남아 있었다. mockup(plans/design/D1Review.dc.html)은
// 줄번호 span에 별도 배경을 주지 않고 행 전체의 var(--add)/var(--del)를 그대로
// 물려받으므로, 두 값이 같아야 한다.

const CSS_PATH = fileURLToPath(new URL("../diff-theme.css", import.meta.url));

function extractBlock(css: string, selectorPattern: RegExp): string {
  const match = selectorPattern.exec(css);
  if (!match) throw new Error(`selector not found: ${selectorPattern}`);
  const start = match.index + match[0].length;
  const end = css.indexOf("}", start);
  if (end === -1) throw new Error(`unterminated block for: ${selectorPattern}`);
  return css.slice(start, end);
}

describe("diff-theme.css (Light)", () => {
  const css = readFileSync(CSS_PATH, "utf8");
  const lightBlock = extractBlock(css, /\[data-theme="light"\]\s*\.diff-style-root\s*\{/);

  it("줄번호 배경이 행 배경(add/del content)과 같은 변수를 가리킨다", () => {
    expect(lightBlock).toMatch(/--diff-add-lineNumber--:\s*var\(--diff-add-content--\)/);
    expect(lightBlock).toMatch(/--diff-del-lineNumber--:\s*var\(--diff-del-content--\)/);
  });

  it("줄번호 글자색은 항상 --ln 토큰을 쓴다 (추가·삭제 줄에서도 동일)", () => {
    expect(lightBlock).toMatch(/--diff-plain-lineNumber-color--:\s*var\(--ln/);
  });
});

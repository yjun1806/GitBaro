import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 색 체계(plans/design/README.md 「색 체계 결정 (2026-09-25)」)를 globals.css 소스에서 검증한다.
// jsdom은 커스텀 프로퍼티와 color-mix를 계산하지 않으므로, 소스 텍스트에서 블록을 뽑아
// var() 참조를 직접 풀어 hex 값을 얻는다.

const css = readFileSync(fileURLToPath(new URL("../globals.css", import.meta.url)), "utf8");

type TokenMap = Map<string, string>;

/** `selector {` 바로 뒤의 블록 본문(중첩 없음 전제)에서 커스텀 프로퍼티를 읽는다. */
function readDeclarations(block: string, into: TokenMap): void {
  const withoutComments = block.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(withoutComments)) !== null) into.set(m[1], m[2].trim());
}

function blocksAfter(pattern: RegExp): string[] {
  const out: string[] = [];
  const re = new RegExp(pattern.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const start = m.index + m[0].length;
    out.push(css.slice(start, css.indexOf("}", start)));
  }
  return out;
}

const lightTokens: TokenMap = new Map();
for (const block of blocksAfter(/:root\s*\{/)) readDeclarations(block, lightTokens);
const darkBlock = blocksAfter(/\.dark\s*\{/)[0];
const darkTokens: TokenMap = new Map(lightTokens);
readDeclarations(darkBlock, darkTokens);

/** var() 별칭을 따라가 최종 hex 값을 얻는다. hex가 아니면 실패한다. */
function resolveHex(tokens: TokenMap, name: string, depth = 0): string {
  if (depth > 10) throw new Error(`alias loop at ${name}`);
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`token not defined: ${name}`);
  const alias = /^var\((--[a-zA-Z0-9-]+)\)$/.exec(value);
  if (alias) return resolveHex(tokens, alias[1], depth + 1);
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error(`${name} is not a plain hex: ${value}`);
  return value.toLowerCase();
}

/** WCAG 2.x 상대 휘도 대비. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_LEVELS = ["--fg", "--fg2", "--muted"] as const;
/** 층 0~3과 사이드바 선택 채움. 글자가 올라가는 모든 바탕. */
const SURFACES = ["--frame", "--frame-sel", "--canvas", "--panel", "--float"] as const;

describe("브랜드 색", () => {
  it("라이트 브랜드 색은 라즈베리 #be3f72이고 primary·ring이 이를 가리킨다", () => {
    expect(resolveHex(lightTokens, "--acc")).toBe("#be3f72");
    expect(resolveHex(lightTokens, "--primary")).toBe("#be3f72");
    expect(resolveHex(lightTokens, "--ring")).toBe("#be3f72");
  });

  it("흰 글자와의 대비가 AA(4.5:1)를 넘는다", () => {
    expect(contrast(resolveHex(lightTokens, "--acc"), "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("hover는 브랜드 색보다 조금 어둡다", () => {
    const lumOf = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
    const acc = resolveHex(lightTokens, "--acc");
    const hover = resolveHex(lightTokens, "--primary-hover");
    expect(lumOf(hover)).toBeLessThan(lumOf(acc));
  });

  it("다크는 밝힌 라즈베리를 쓰고, 버튼 글자와 대비가 AA를 넘는다", () => {
    const acc = resolveHex(darkTokens, "--acc");
    expect(acc).toBe("#e26b9a");
    expect(contrast(acc, resolveHex(darkTokens, "--primary-foreground"))).toBeGreaterThanOrEqual(4.5);
  });

  it("CI 실패 빨강(--danger)은 브랜드 색과 다른 토마토 레드다", () => {
    expect(resolveHex(lightTokens, "--danger")).toBe("#d2442a");
    expect(resolveHex(lightTokens, "--danger")).not.toBe(resolveHex(lightTokens, "--acc"));
    expect(resolveHex(lightTokens, "--live")).toBe("#e5700b");
  });
});

describe("층", () => {
  it("0 창 틀 #e9e9e7, 1 본문 바탕 #f1f1ef, 2 패널·3 떠 있는 요소 흰색", () => {
    expect(resolveHex(lightTokens, "--frame")).toBe("#e9e9e7");
    expect(resolveHex(lightTokens, "--canvas")).toBe("#f1f1ef");
    expect(resolveHex(lightTokens, "--panel")).toBe("#ffffff");
    expect(resolveHex(lightTokens, "--float")).toBe("#ffffff");
    expect(resolveHex(lightTokens, "--background")).toBe("#f1f1ef");
    expect(resolveHex(lightTokens, "--popover")).toBe("#ffffff");
  });

  it("사이드바 선택 채움은 #dededc이고 hover 채움은 그보다 옅다", () => {
    expect(resolveHex(lightTokens, "--frame-sel")).toBe("#dededc");
    const hover = resolveHex(lightTokens, "--frame-hover");
    expect(contrast(hover, "#ffffff")).toBeLessThan(contrast("#dededc", "#ffffff"));
    expect(contrast(hover, "#ffffff")).toBeGreaterThan(contrast("#e9e9e7", "#ffffff"));
  });

  it("떠 있는 요소 그림자는 패널 그림자보다 진하고, Tailwind shadow-lg/xl/2xl이 이를 쓴다", () => {
    expect(lightTokens.get("--shadow-float")).toBeDefined();
    expect(lightTokens.get("--shadow-float")).not.toBe(lightTokens.get("--shadow"));
    for (const name of ["--shadow-lg", "--shadow-xl", "--shadow-2xl"]) {
      expect(css).toMatch(new RegExp(`${name}:\\s*var\\(--shadow-float\\)`));
    }
  });

  it("다크 블록도 층 토큰 이름을 모두 정의한다", () => {
    const own: TokenMap = new Map();
    readDeclarations(darkBlock, own);
    for (const name of ["--frame", "--frame-hover", "--frame-sel", "--canvas", "--panel", "--float", "--shadow-float", "--acc-hover", "--status-fail"]) {
      expect(own.has(name), `${name} missing in .dark`).toBe(true);
    }
  });
});

describe("글자 세 단계의 대비", () => {
  it("라이트 글자 값: 본문 #1a1a19, 보조 #4a4a47, 설명 #62625f", () => {
    expect(resolveHex(lightTokens, "--fg")).toBe("#1a1a19");
    expect(resolveHex(lightTokens, "--fg2")).toBe("#4a4a47");
    expect(resolveHex(lightTokens, "--muted")).toBe("#62625f");
    // 예전 네 번째 단계(--faint)는 설명 단계로 합쳤다.
    expect(resolveHex(lightTokens, "--faint")).toBe(resolveHex(lightTokens, "--muted"));
    expect(resolveHex(lightTokens, "--muted-foreground")).toBe(resolveHex(lightTokens, "--muted"));
  });

  for (const [theme, tokens] of [
    ["light", lightTokens],
    ["dark", darkTokens],
  ] as const) {
    for (const text of TEXT_LEVELS) {
      for (const surface of SURFACES) {
        it(`${theme}: ${text} on ${surface} ≥ 4.5:1`, () => {
          const ratio = contrast(resolveHex(tokens, text), resolveHex(tokens, surface));
          expect(ratio).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  }

  it("대비 계산 자체가 맞다 (검은 글자/흰 바탕 21:1, 같은 색 1:1)", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrast("#777777", "#777777")).toBe(1);
  });
});

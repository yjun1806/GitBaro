import { describe, expect, it } from "vitest";
import { branchColorOf, hueOf, laneLabelColors, laneLabelStyle } from "../lane-style";
import { worktreeColor } from "../worktree-history";

type Rgb = [number, number, number];

/** CSS hsl/hsla → 0..1 RGB와 알파. */
function parse(color: string): { rgb: Rgb; alpha: number } {
  const m = /hsla?\(\s*([\d.]+),\s*([\d.]+)%,\s*([\d.]+)%(?:,\s*([\d.]+))?\)/.exec(color);
  if (!m) throw new Error(`not hsl: ${color}`);
  const [h, s, l] = [Number(m[1]) / 360, Number(m[2]) / 100, Number(m[3]) / 100];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t: number) => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return { rgb: [ch(h + 1 / 3), ch(h), ch(h - 1 / 3)], alpha: m[4] === undefined ? 1 : Number(m[4]) };
}

function luminance([r, g, b]: Rgb): number {
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function over(color: string, base: Rgb): Rgb {
  const { rgb, alpha } = parse(color);
  return rgb.map((c, i) => alpha * c + (1 - alpha) * base[i]) as Rgb;
}

const PANEL_LIGHT: Rgb = [1, 1, 1]; // --panel #ffffff
const PANEL_DARK: Rgb = [0x22 / 255, 0x22 / 255, 0x22 / 255]; // --panel var(--gray-950)

describe("lane label colours", () => {
  it("keeps the label text at 4.5:1 or more on every hue, in both themes", () => {
    for (let hue = 0; hue < 360; hue++) {
      const c = laneLabelColors(`hsl(${hue}, 55%, 45%)`)!;
      expect(contrast(parse(c.fg).rgb, over(c.bg, PANEL_LIGHT))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(parse(c.fgDark).rgb, over(c.bgDark, PANEL_DARK))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("uses the worktree's own hue, so the label matches its lane and chip", () => {
    const color = worktreeColor("/repos/app-feat");
    const c = laneLabelColors(color)!;
    expect(hueOf(c.fg)).toBe(hueOf(color));
    expect(laneLabelStyle(color)).toMatchObject({ "--lane-fg": c.fg });
  });

  it("leaves labels gray when there is no lane colour", () => {
    expect(laneLabelStyle(null)).toBeUndefined();
    expect(laneLabelStyle("var(--ln)")).toBeUndefined();
  });
});

describe("branchColorOf", () => {
  const colors = new Map([["feat/x", "hsl(10, 55%, 45%)"]]);

  it("colours a branch and its remote copy with the worktree that checked it out", () => {
    expect(branchColorOf("feat/x", false, colors)).toBe("hsl(10, 55%, 45%)");
    expect(branchColorOf("origin/feat/x", true, colors)).toBe("hsl(10, 55%, 45%)");
  });

  it("leaves branches that no shown worktree has checked out uncoloured", () => {
    expect(branchColorOf("main", false, colors)).toBeNull();
    expect(branchColorOf("origin/main", true, colors)).toBeNull();
    // 로컬 브랜치 이름에 슬래시가 있어도 원격처럼 잘라 보지 않는다.
    expect(branchColorOf("x/feat/x", false, colors)).toBeNull();
  });
});

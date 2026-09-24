import type { CSSProperties } from "react";

/**
 * 워크트리 색 하나로 그래프를 칠하는 규칙(칩 견본 = 레인 = 브랜치 이름표).
 * 워크트리에 묶이지 않은 줄기(merge된 브랜치 등)는 회색 선으로 그린다.
 */

/** 워크트리에 묶이지 않은 줄기의 선 색. */
export const MUTED_LANE = "var(--ln)";

/** `hsl(h, s%, l%)`의 색조. 못 읽으면 null. */
export function hueOf(color: string): number | null {
  const m = /hsla?\(\s*(-?\d+(?:\.\d+)?)/.exec(color);
  return m ? Number(m[1]) : null;
}

/** 이름표 바탕 투명도(밝은 테마 / 어두운 테마). */
const LABEL_BG_ALPHA = { light: 0.14, dark: 0.2 } as const;
/** 이름표 글자 명도(%). 모든 색조에서 바탕 대비 4.5:1을 넘도록 고른 값이다(lane-style 테스트). */
const LABEL_TEXT_LIGHTNESS = { light: 26, dark: 74 } as const;

/** 이름표 색 세 가지: 옅은 바탕, 같은 색조의 진한 글자(밝은 테마), 밝은 글자(어두운 테마). */
export function laneLabelColors(color: string): { bg: string; bgDark: string; fg: string; fgDark: string } | null {
  const hue = hueOf(color);
  if (hue === null) return null;
  return {
    bg: `hsla(${hue}, 55%, 45%, ${LABEL_BG_ALPHA.light})`,
    bgDark: `hsla(${hue}, 55%, 45%, ${LABEL_BG_ALPHA.dark})`,
    fg: `hsl(${hue}, 60%, ${LABEL_TEXT_LIGHTNESS.light}%)`,
    fgDark: `hsl(${hue}, 65%, ${LABEL_TEXT_LIGHTNESS.dark}%)`,
  };
}

/** 레인 색 이름표의 클래스. `laneLabelStyle`이 넣는 CSS 변수를 쓴다. */
export const LANE_LABEL_CLASS =
  "bg-(--lane-bg) text-(--lane-fg) dark:bg-(--lane-bg-dark) dark:text-(--lane-fg-dark)";

/** 레인 색 이름표의 인라인 스타일(CSS 변수). 색을 못 읽으면 undefined(회색 이름표로 둔다). */
export function laneLabelStyle(color: string | null | undefined): CSSProperties | undefined {
  const c = color ? laneLabelColors(color) : null;
  if (!c) return undefined;
  return {
    "--lane-bg": c.bg,
    "--lane-bg-dark": c.bgDark,
    "--lane-fg": c.fg,
    "--lane-fg-dark": c.fgDark,
  } as CSSProperties;
}

/**
 * 브랜치 이름 → 그 브랜치를 체크아웃한 (그래프에 보이는) 워크트리의 색. 원격 브랜치(`origin/feat/x`)는
 * 같은 이름의 로컬 브랜치 색을 따른다. 어느 워크트리에도 묶이지 않은 브랜치는 null.
 */
export function branchColorOf(
  name: string,
  isRemote: boolean,
  colorByBranch: ReadonlyMap<string, string>,
): string | null {
  const direct = colorByBranch.get(name);
  if (direct) return direct;
  if (!isRemote) return null;
  const slash = name.indexOf("/");
  return slash >= 0 ? (colorByBranch.get(name.slice(slash + 1)) ?? null) : null;
}

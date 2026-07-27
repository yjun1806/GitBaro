import type { CoverageResult, DiffCoverage } from "@/types";

// V12 — diff 커버리지 거터의 순수 로직.
//
// 지켜야 할 정직성 규칙 두 가지:
//
// 1. 커버리지를 **아는 것**과 **0%인 것**은 완전히 다르다. 리포트가 없거나 파일이
//    리포트에 없으면 그건 `noData`지 "미커버"가 아니다. 0%로 표시하면 없는 사실을
//    지어내는 것이다.
// 2. 백엔드가 주는 것은 *추가된* 라인의 커버리지뿐이다. 컨텍스트·삭제 라인에는
//    표시할 근거가 없으므로 아무 표시도 하지 않는다.

export type CoverageLineState = "covered" | "uncovered" | "noData";

export interface CoverageLookup {
  /** 리포트에서 이 파일에 해당하는 행. 없으면 null. */
  entry: DiffCoverage | null;
  /** 리포트가 "실행된 적 없다"고 말한 추가 라인 번호. */
  uncoveredLines: ReadonlySet<number>;
  /** 이 파일이 파싱된 리포트에 있다. false면 모든 라인이 `noData`. */
  known: boolean;
  /** 백엔드가 "리포트에 없는 변경 파일"로 명시한 경우. */
  unmapped: boolean;
  /** 커버리지 리포트 자체를 찾지 못했다. */
  reportMissing: boolean;
}

export const EMPTY_COVERAGE_LOOKUP: CoverageLookup = {
  entry: null,
  uncoveredLines: new Set<number>(),
  known: false,
  unmapped: false,
  reportMissing: true,
};

/** `CoverageResult`(diff 전체)에서 파일 하나에 대한 조회 구조를 만든다. */
export function buildCoverageLookup(
  result: CoverageResult | null | undefined,
  filePath: string,
): CoverageLookup {
  // `source`가 비어 있으면 백엔드가 lcov을 못 찾았다는 뜻이다(에러가 아니다).
  if (!result || result.source === "") return EMPTY_COVERAGE_LOOKUP;

  const entry = result.files.find((file) => file.path === filePath) ?? null;

  return {
    entry,
    uncoveredLines: new Set(entry?.uncoveredAddedLines ?? []),
    known: entry !== null,
    unmapped: entry === null && result.unmappedFiles.includes(filePath),
    reportMissing: false,
  };
}

/**
 * 한 diff 행의 커버리지 상태. `isAdded`가 아니거나 새 라인 번호가 없으면 판정 대상이
 * 아니므로 `noData`다.
 */
export function coverageLineState(
  lookup: CoverageLookup,
  isAdded: boolean,
  newLineNumber: number | null,
): CoverageLineState {
  if (!isAdded || newLineNumber === null || !lookup.known) return "noData";
  return lookup.uncoveredLines.has(newLineNumber) ? "uncovered" : "covered";
}

export const COVERAGE_LINE_CLASS: Record<CoverageLineState, string> = {
  covered: "bg-success/60",
  uncovered: "bg-danger/70",
  // 판정 근거가 없을 때는 아무것도 칠하지 않는다 — 빈 거터가 "미커버"로 읽히면 안 된다.
  noData: "bg-transparent",
};

export function coverageLineClass(state: CoverageLineState): string {
  return COVERAGE_LINE_CLASS[state];
}

/** 헤더 요약이 그릴 수 있는 경우의 수. `measured`에만 숫자가 붙는다. */
export type CoverageSummary =
  | { kind: "noReport" }
  | { kind: "unmapped" }
  | { kind: "noAddedLines" }
  | { kind: "measured"; added: number; covered: number; uncovered: number };

export function coverageSummary(lookup: CoverageLookup): CoverageSummary {
  if (lookup.reportMissing) return { kind: "noReport" };
  if (!lookup.entry) return { kind: "unmapped" };
  if (lookup.entry.addedLines === 0) return { kind: "noAddedLines" };

  return {
    kind: "measured",
    added: lookup.entry.addedLines,
    covered: lookup.entry.coveredAddedLines,
    uncovered: lookup.entry.uncoveredAddedLines.length,
  };
}

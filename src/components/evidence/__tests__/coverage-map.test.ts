import { describe, expect, it } from "vitest";
import type { CoverageResult } from "@/types";
import {
  COVERAGE_LINE_CLASS,
  EMPTY_COVERAGE_LOOKUP,
  buildCoverageLookup,
  coverageLineClass,
  coverageLineState,
  coverageSummary,
} from "../coverage-map";

const RESULT: CoverageResult = {
  source: "coverage/lcov.info",
  parsedAt: 1_700_000_000_000,
  files: [
    {
      path: "src/a.ts",
      addedLines: 5,
      coveredAddedLines: 3,
      uncoveredAddedLines: [12, 13],
    },
    {
      path: "src/empty.ts",
      addedLines: 0,
      coveredAddedLines: 0,
      uncoveredAddedLines: [],
    },
  ],
  unmappedFiles: ["src/b.py"],
};

describe("buildCoverageLookup", () => {
  it("리포트를 못 찾았으면 (source 빈 문자열) 전부 '모름'이다", () => {
    const empty: CoverageResult = { ...RESULT, source: "" };
    expect(buildCoverageLookup(empty, "src/a.ts")).toEqual(EMPTY_COVERAGE_LOOKUP);
    expect(buildCoverageLookup(null, "src/a.ts").reportMissing).toBe(true);
    expect(buildCoverageLookup(undefined, "src/a.ts").reportMissing).toBe(true);
  });

  it("리포트에 있는 파일은 미커버 라인 집합과 함께 known이 된다", () => {
    const lookup = buildCoverageLookup(RESULT, "src/a.ts");
    expect(lookup.known).toBe(true);
    expect(lookup.unmapped).toBe(false);
    expect(lookup.reportMissing).toBe(false);
    expect([...lookup.uncoveredLines].sort()).toEqual([12, 13]);
  });

  it("unmappedFiles에 있는 파일은 known이 아니라 unmapped다", () => {
    const lookup = buildCoverageLookup(RESULT, "src/b.py");
    expect(lookup.known).toBe(false);
    expect(lookup.unmapped).toBe(true);
    expect(lookup.entry).toBeNull();
  });

  it("리포트에도 unmapped에도 없는 파일은 known이 아니다", () => {
    const lookup = buildCoverageLookup(RESULT, "src/unknown.ts");
    expect(lookup.known).toBe(false);
    expect(lookup.unmapped).toBe(false);
  });
});

describe("coverageLineState", () => {
  const known = buildCoverageLookup(RESULT, "src/a.ts");
  const unknown = buildCoverageLookup(RESULT, "src/b.py");

  it("미커버 목록에 있는 추가 라인은 uncovered다", () => {
    expect(coverageLineState(known, true, 12)).toBe("uncovered");
    expect(coverageLineState(known, true, 13)).toBe("uncovered");
  });

  it("리포트에 있는 파일의 나머지 추가 라인은 covered다", () => {
    expect(coverageLineState(known, true, 11)).toBe("covered");
  });

  // 백엔드는 추가 라인의 커버리지만 준다. 컨텍스트·삭제 라인에는 근거가 없다.
  it("추가 라인이 아니면 언제나 noData다", () => {
    expect(coverageLineState(known, false, 11)).toBe("noData");
    expect(coverageLineState(known, false, 12)).toBe("noData");
  });

  it("새 라인 번호가 없으면 noData다", () => {
    expect(coverageLineState(known, true, null)).toBe("noData");
  });

  // 0%가 아니라 "모름"이어야 한다.
  it("리포트에 없는 파일은 미커버가 아니라 noData다", () => {
    expect(coverageLineState(unknown, true, 1)).toBe("noData");
    expect(coverageLineState(EMPTY_COVERAGE_LOOKUP, true, 1)).toBe("noData");
  });
});

describe("coverageLineClass", () => {
  it("상태별 클래스가 시맨틱 토큰으로 고정돼 있다", () => {
    expect(COVERAGE_LINE_CLASS).toEqual({
      covered: "bg-success/60",
      uncovered: "bg-danger/70",
      noData: "bg-transparent",
    });
  });

  it("noData는 아무것도 칠하지 않는다", () => {
    expect(coverageLineClass("noData")).toBe("bg-transparent");
  });

  it("covered와 uncovered는 서로 다른 클래스를 낸다", () => {
    expect(coverageLineClass("covered")).not.toBe(coverageLineClass("uncovered"));
  });
});

describe("coverageSummary", () => {
  it("리포트가 없으면 숫자 대신 noReport를 낸다 (0%가 아니다)", () => {
    expect(coverageSummary(EMPTY_COVERAGE_LOOKUP)).toEqual({ kind: "noReport" });
  });

  it("리포트에 없는 파일은 unmapped다", () => {
    expect(coverageSummary(buildCoverageLookup(RESULT, "src/b.py"))).toEqual({ kind: "unmapped" });
  });

  it("추가 라인이 0줄이면 비율을 만들지 않는다", () => {
    expect(coverageSummary(buildCoverageLookup(RESULT, "src/empty.ts"))).toEqual({
      kind: "noAddedLines",
    });
  });

  it("측정된 파일은 추가/커버/미커버 수를 그대로 싣는다", () => {
    expect(coverageSummary(buildCoverageLookup(RESULT, "src/a.ts"))).toEqual({
      kind: "measured",
      added: 5,
      covered: 3,
      uncovered: 2,
    });
  });
});

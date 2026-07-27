import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useDiffCoverage } from "@/api/queries";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { Finding } from "@/types";
import {
  buildCoverageLookup,
  coverageLineClass,
  coverageSummary,
  type CoverageLineState,
  type CoverageLookup,
} from "./coverage-map";

const LEGEND_STATES: CoverageLineState[] = ["covered", "uncovered", "noData"];

/**
 * diff 한 파일에 대한 커버리지 조회 구조. 쿼리는 diff 전체를 한 번만 가져오므로
 * 여러 파일이 같은 캐시를 공유한다.
 */
export function useCoverageLookup(
  repoPath: string | null,
  filePath: string,
  oid: string | null = null,
): CoverageLookup {
  const { data } = useDiffCoverage(repoPath, oid);
  return useMemo(() => buildCoverageLookup(data ?? null, filePath), [data, filePath]);
}

export interface CoverageLineMarkProps {
  state: CoverageLineState;
}

/**
 * diff 행 하나에 붙는 커버리지 표시. `VirtualizedDiffView`의 행 구조(flex 셀 + 세로로
 * 늘어나는 줄번호 칸)에 맞춰 줄번호 칸 **앞에** 놓이는 얇은 세로 막대다.
 * `noData`는 아무것도 칠하지 않는다 — 빈 칸이 "미커버"로 읽히면 안 된다.
 */
export function CoverageLineMark({ state }: CoverageLineMarkProps) {
  const { t } = useTranslation();
  return (
    <span
      aria-hidden={state === "noData"}
      title={state === "noData" ? undefined : t(`verify.coverage.legend.${state}`)}
      style={{ alignSelf: "stretch" }}
      className={cn("w-1 shrink-0", coverageLineClass(state))}
    />
  );
}

export interface CoverageGutterProps {
  repoPath: string | null;
  filePath: string;
  /** 커밋을 측정하려면 oid를 준다. 생략하면 워킹트리를 측정한다. */
  oid?: string | null;
  /**
   * 이 파일의 V3(테스트 품질) findings. **커버리지 숫자는 절대 단독으로 표시하지
   * 않는다** (spec §V12·P3) — 이 목록이 그 짝이다.
   */
  qualityFindings?: Finding[];
  /** V3가 돌지 않았으면 `false`. 품질이 검사된 것처럼 보이지 않게 명시한다. */
  qualityChecked?: boolean;
  onShowQualityFindings?: () => void;
}

/**
 * V12 — 추가 라인 커버리지 요약.
 *
 * 강제 제약 두 가지:
 * - 커버리지 숫자 옆에는 언제나 "커버리지는 실행을 증명할 뿐 검증을 증명하지 않는다"가
 *   붙는다. 숫자만 남기면 잘못된 안심을 준다.
 * - 리포트가 없으면 0%가 아니라 "알 수 없다"고 말한다.
 */
export function CoverageGutter({
  repoPath,
  filePath,
  oid = null,
  qualityFindings = [],
  qualityChecked,
  onShowQualityFindings,
}: CoverageGutterProps) {
  const { t } = useTranslation();
  const { data } = useDiffCoverage(repoPath, oid);
  const lookup = useMemo(() => buildCoverageLookup(data ?? null, filePath), [data, filePath]);
  const summary = coverageSummary(lookup);

  return (
    <div className="flex flex-col gap-1 border-b border-border bg-surface px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{t("verify.coverage.title")}</span>

        {summary.kind === "measured" && (
          <>
            <span>
              {t("verify.coverage.covered", {
                covered: summary.covered,
                added: summary.added,
              })}
            </span>
            {summary.uncovered > 0 && (
              <span className="text-danger">
                {t("verify.coverage.uncovered", { count: summary.uncovered })}
              </span>
            )}
          </>
        )}

        {summary.kind === "noReport" && (
          <span className="text-muted-foreground">{t("verify.coverage.absent")}</span>
        )}
        {summary.kind === "unmapped" && (
          <span className="text-muted-foreground">{t("verify.coverage.fileUnmapped")}</span>
        )}
        {summary.kind === "noAddedLines" && (
          <span className="text-muted-foreground">{t("verify.coverage.noAddedLines")}</span>
        )}

        {data && data.source !== "" && (
          <span className="text-muted-foreground">
            {t("verify.coverage.source", { path: data.source })} ·{" "}
            {t("verify.coverage.parsedAt", { time: formatRelativeTime(data.parsedAt / 1000) })}
          </span>
        )}
      </div>

      {/* P3: 숫자 옆에 반드시 붙는다. 커버리지는 "실행됨"만 증명한다. */}
      <p className="text-muted-foreground">{t("verify.coverage.qualityNote")}</p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {qualityFindings.length > 0 ? (
          onShowQualityFindings ? (
            <button
              type="button"
              onClick={onShowQualityFindings}
              className="rounded px-1.5 py-0.5 font-medium text-accent transition-colors hover:bg-accent/10"
            >
              {t("verify.coverage.qualityFindings", { count: qualityFindings.length })}
            </button>
          ) : (
            <span className="font-medium">
              {t("verify.coverage.qualityFindings", { count: qualityFindings.length })}
            </span>
          )
        ) : (
          qualityChecked === false && (
            <span className="text-muted-foreground">
              {t("verify.coverage.qualityNotChecked")}
            </span>
          )
        )}

        <span className="flex items-center gap-2 text-muted-foreground">
          {LEGEND_STATES.map((state) => (
            <span key={state} className="flex items-center gap-1">
              <span
                className={cn(
                  "h-3 w-1 rounded-sm",
                  state === "noData" ? "bg-border" : coverageLineClass(state),
                )}
              />
              {t(`verify.coverage.legend.${state}`)}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

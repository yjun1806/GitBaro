import { useTranslation } from "react-i18next";
import { GitCompare, X } from "lucide-react";
import { useRepositoryStore } from "@/stores/repository";
import { activeRange, rangeLabel, useBranchRangeStore } from "@/components/branch/branch-range";

/** 그래프 머리에 달 비교 표시(`main..feat/x`). 비교 중이 아니면 null. */
export function compareChipLabel(range: { base: string; target: string } | null): string | null {
  return range ? rangeLabel(range) : null;
}

/**
 * 「main..feat/x 비교 중 ×」. 비교는 브랜치 패널의 「비교」로 시작하고, 여기서 끝낸다.
 * 예전 「비교할 Branch를 선택하세요」 줄을 그래프 위에서 뺀 자리다.
 */
export function CompareChip() {
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const stored = useBranchRangeStore((s) => s.range);
  const clearRange = useBranchRangeStore((s) => s.clear);
  const range = activeRange(stored, activeRepoPath);
  const label = compareChipLabel(range);
  if (label === null) return null;

  return (
    <span
      className="flex items-center gap-1 shrink-0 min-w-0 max-w-[320px] h-6 pl-2 pr-0.5 rounded-(--radius-chip) bg-info/10 text-[11.5px] font-semibold text-foreground"
      data-testid="compare-chip"
    >
      <GitCompare className="w-3 h-3 shrink-0" aria-hidden="true" />
      <span className="truncate" title={label}>
        {t("graph.comparing", { range: label })}
      </span>
      <button
        type="button"
        onClick={clearRange}
        aria-label={t("graph.endCompare")}
        title={t("graph.endCompare")}
        className="flex items-center justify-center w-5 h-5 shrink-0 rounded-(--radius-chip) text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}

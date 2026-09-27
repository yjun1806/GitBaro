import { GitBranch } from "lucide-react";
import { useTranslation } from "react-i18next";
import { FilterChip } from "@/components/ui/FilterChip";

/** 브랜치 단계 Actions·PR 탭의 「이 브랜치만」 필터(5.1). 끄면 저장소 전체를 보인다. */
export interface BranchOnlyFilter {
  branch: string;
  on: boolean;
  onToggle: () => void;
}

export function BranchOnlyChip({ filter }: { filter: BranchOnlyFilter }) {
  const { t } = useTranslation();
  return (
    <FilterChip
      pressed={filter.on}
      onClick={filter.onToggle}
      icon={<GitBranch className="w-3 h-3 shrink-0 text-muted-foreground" aria-hidden="true" />}
      title={t("scope.thisBranchOnlyHint", { branch: filter.branch })}
    >
      {t("scope.thisBranchOnly")}
    </FilterChip>
  );
}

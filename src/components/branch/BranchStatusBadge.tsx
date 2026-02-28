import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { isStale } from "@/hooks/useBranchGroups";
import type { BranchInfo } from "@/types";

interface BranchStatusBadgeProps {
  branch: BranchInfo;
}

export function BranchStatusBadge({ branch }: BranchStatusBadgeProps) {
  const { t } = useTranslation();

  if (branch.isRemote || branch.isDefault) return null;

  // Merged takes priority over Stale (mutually exclusive)
  if (branch.isFullyMerged) {
    return (
      <span
        className={cn(
          "inline-flex items-center text-[10px] leading-none font-medium px-1.5 py-[3px] rounded shrink-0",
          "bg-success/15 text-success",
        )}
      >
        {t("branch.merged")}
      </span>
    );
  }

  if (isStale(branch)) {
    return (
      <span
        className={cn(
          "inline-flex items-center text-[10px] leading-none font-medium px-1.5 py-[3px] rounded shrink-0",
          "bg-warning/15 text-warning",
        )}
      >
        {t("branch.stale")}
      </span>
    );
  }

  return null;
}

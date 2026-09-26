import { useTranslation } from "react-i18next";
import { isStale } from "@/hooks/useBranchGroups";
import { StatusChip } from "@/components/ui/marks";
import type { BranchInfo } from "@/types";

interface BranchStatusBadgeProps {
  branch: BranchInfo;
}

export function BranchStatusBadge({ branch }: BranchStatusBadgeProps) {
  const { t } = useTranslation();

  if (branch.isRemote || branch.isDefault) return null;

  // Merged takes priority over Stale (mutually exclusive)
  if (branch.isFullyMerged) {
    return <StatusChip tone="success">{t("branch.merged")}</StatusChip>;
  }

  if (isStale(branch)) {
    return <StatusChip tone="warning">{t("branch.stale")}</StatusChip>;
  }

  return null;
}

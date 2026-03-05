import { useTranslation } from "react-i18next";
import { Play, Loader2 } from "lucide-react";
import { ActionsRunItem } from "./ActionsRunItem";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";
import type { WorkflowRun } from "@/types";

interface ActionsListProps {
  runs: WorkflowRun[];
  isLoading: boolean;
  selectedRunId: number | null;
  onSelectRun: (id: number) => void;
}

export function ActionsList({
  runs,
  isLoading,
  selectedRunId,
  onSelectRun,
}: ActionsListProps) {
  const { t } = useTranslation();

  const selectedIdx = runs.findIndex((r) => r.id === selectedRunId);

  const { activeIndex, containerProps, itemRef } = useListKeyboardNav({
    items: runs,
    onSelect: (r) => onSelectRun(r.id),
    selectedIndex: selectedIdx,
  });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3 py-12">
        <Loader2 className="w-6 h-6 animate-spin" />
        <p className="text-xs">{t("common.loading")}</p>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3 py-12">
        <div className="w-12 h-12 rounded-full bg-surface flex items-center justify-center">
          <Play className="w-6 h-6" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium">{t("actions.noRuns")}</p>
          <p className="text-xs mt-1">{t("actions.noRunsDescription")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto" {...containerProps}>
      {runs.map((run, index) => (
        <ActionsRunItem
          key={run.id}
          ref={itemRef(index)}
          run={run}
          isSelected={selectedRunId === run.id}
          isHighlighted={activeIndex === index}
          onClick={() => onSelectRun(run.id)}
        />
      ))}
    </div>
  );
}

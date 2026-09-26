import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Play } from "lucide-react";
import { contextMenuPoint } from "@/components/ui/ContextMenu";
import { ActionsRunItem } from "./ActionsRunItem";
import { ActionsRunContextMenu } from "./ActionsRunContextMenu";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";
import type { WorkflowRun } from "@/types";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";

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
  const [menu, setMenu] = useState<{ run: WorkflowRun; x: number; y: number } | null>(null);

  const selectedIdx = runs.findIndex((r) => r.id === selectedRunId);

  const { activeIndex, containerProps, itemRef } = useListKeyboardNav({
    items: runs,
    onSelect: (r) => onSelectRun(r.id),
    selectedIndex: selectedIdx,
  });

  if (isLoading) {
    return <LoadingState className="h-full" />;
  }

  if (runs.length === 0) {
    return <EmptyState icon={Play} title={t("actions.noRuns")} description={t("actions.noRunsDescription")} />;
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
          onContextMenu={(e) => {
            e.preventDefault();
            onSelectRun(run.id);
            setMenu({ run, ...contextMenuPoint(e) });
          }}
        />
      ))}

      {menu && (
        <ActionsRunContextMenu run={menu.run} position={{ x: menu.x, y: menu.y }} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}

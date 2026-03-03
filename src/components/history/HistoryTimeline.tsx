import { useTranslation } from "react-i18next";
import type { CommitInfo } from "@/types";
import { CommitItem } from "./CommitItem";

interface HistoryTimelineProps {
  commits: CommitInfo[];
  selectedOid?: string;
  onSelectCommit: (commit: CommitInfo) => void;
}

export function HistoryTimeline({
  commits,
  selectedOid,
  onSelectCommit,
}: HistoryTimelineProps) {
  const { t } = useTranslation();

  if (commits.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {t("history.noCommits")}
      </div>
    );
  }

  return (
    <div className="flex flex-col overflow-y-auto">
      {commits.map((commit) => (
        <CommitItem
          key={commit.id}
          commit={commit}
          isSelected={commit.id === selectedOid}
          onClick={() => onSelectCommit(commit)}
        />
      ))}
    </div>
  );
}

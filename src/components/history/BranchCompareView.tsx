import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownToLine, ArrowUpFromLine, Loader2 } from "lucide-react";
import { useBranchComparison } from "@/api/queries";
import { TabGroup, Tab } from "@/components/ui/Tabs";
import { getErrorMessage } from "@/lib/utils";
import { CommitItem } from "./CommitItem";

interface BranchCompareViewProps {
  repoPath: string;
  baseBranch: string;
  compareBranch: string;
  selectedCommitId: string | null;
  onSelectCommit: (id: string) => void;
  resolveAvatarUrl?: (email: string) => string | undefined;
}

type CompareTab = "incoming" | "outgoing";

export function BranchCompareView({
  repoPath,
  baseBranch,
  compareBranch,
  selectedCommitId,
  onSelectCommit,
  resolveAvatarUrl,
}: BranchCompareViewProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<CompareTab>("incoming");
  const { data, isLoading, error } = useBranchComparison(
    repoPath,
    baseBranch,
    compareBranch,
  );

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t("compare.loading")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-destructive">
        {getErrorMessage(error)}
      </div>
    );
  }

  if (!data) return null;

  if (data.aheadCount === 0 && data.behindCount === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {t("compare.identical")}
      </div>
    );
  }

  /**
   * Git ↔ UI 용어 매핑:
   * - aheadCount / aheadCommits  → "Outgoing" (현재 브랜치에만 있는 커밋, push 대상)
   * - behindCount / behindCommits → "Incoming" (비교 브랜치에만 있는 커밋, merge 대상)
   */
  const incoming = { count: data.behindCount, commits: data.behindCommits };
  const outgoing = { count: data.aheadCount, commits: data.aheadCommits };
  const activeCommits =
    activeTab === "incoming" ? incoming.commits : outgoing.commits;
  const emptyMessage =
    activeTab === "incoming"
      ? t("compare.noIncomingCommits")
      : t("compare.noOutgoingCommits");

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Tab bar */}
      <TabGroup className="shrink-0">
        <Tab
          active={activeTab === "incoming"}
          onClick={() => setActiveTab("incoming")}
          icon={<ArrowDownToLine className="w-3.5 h-3.5" />}
          count={incoming.count}
          color="info"
          size="sm"
        >
          {t("compare.incoming")}
        </Tab>
        <Tab
          active={activeTab === "outgoing"}
          onClick={() => setActiveTab("outgoing")}
          icon={<ArrowUpFromLine className="w-3.5 h-3.5" />}
          count={outgoing.count}
          color="success"
          size="sm"
        >
          {t("compare.outgoing")}
        </Tab>
      </TabGroup>

      {/* Commit list */}
      <div className="flex-1 overflow-y-auto">
        {activeCommits.length > 0 ? (
          activeCommits.map((commit) => (
            <CommitItem
              key={commit.id}
              commit={commit}
              isSelected={commit.id === selectedCommitId}
              avatarUrl={resolveAvatarUrl?.(commit.author.email ?? "")}
              onClick={() => onSelectCommit(commit.id)}
            />
          ))
        ) : (
          <div className="flex-1 flex items-center justify-center py-8 text-xs text-muted-foreground">
            {emptyMessage}
          </div>
        )}
      </div>
    </div>
  );
}

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitPullRequest, Globe, MessageSquare, RefreshCw, UserX, WifiOff } from "lucide-react";
import { useBranches, usePullRequests, useRefreshPullRequests } from "@/api/queries";
import { useRepositoryStore } from "@/stores/repository";
import { useRepoAccountId } from "@/hooks/useRepoAccountId";
import { useMenuActions } from "@/hooks/useMenuActions";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";
import { checkedOutBranch } from "@/components/graph/useHistoryView";
import { contextMenuPoint } from "@/components/ui/ContextMenu";
import { cn, gitHubRepoUrl } from "@/lib/utils";
import type { PrStateFilter, PullRequestSummary } from "@/types";
import { orderForBranch } from "./pr-model";
import { selectedPrNumber, usePrViewStore } from "./pr-view";
import { usePrMenu } from "./usePrMenu";
import { BranchPair, CiChip, DraftChip, PrAvatar, PrStateIcon, ReviewDecisionChip, TimeAgo } from "./PrBits";
import { PrError, PrLoading, PrPlaceholder } from "./PrStates";
import { BusyIcon } from "@/components/ui/Spinner";

const FILTERS: PrStateFilter[] = ["open", "closed", "all"];

/**
 * 그래프 패널의 「PR」 탭: 이 저장소의 PR 목록. 고른 PR의 상세는 아래 칸(`PrDetailPane`)에 그린다.
 * 지금 체크아웃한 브랜치의 열린 PR은 맨 위에 두고 표시한다.
 */
export function PrListView() {
  const { t } = useTranslation();
  const activeRepo = useRepositoryStore((s) => s.activeRepo);
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const repoUrl = useRepositoryStore((s) => gitHubRepoUrl(s.activeRepo?.remotes ?? []));
  const accountId = useRepoAccountId();
  const filter = usePrViewStore((s) => s.filter);
  const setFilter = usePrViewStore((s) => s.setFilter);
  const selectedNumber = usePrViewStore((s) => selectedPrNumber(s, activeRepoPath));
  const select = usePrViewStore((s) => s.select);
  const actions = useMenuActions();
  const refresh = useRefreshPullRequests();
  const [refreshing, setRefreshing] = useState(false);

  const hasRemote = activeRepo ? activeRepo.remotes.length > 0 : false;
  const repoPath = hasRemote && repoUrl ? activeRepoPath : null;
  const { data, isLoading, isError, error, refetch } = usePullRequests(repoPath, accountId, filter);
  const { data: branches } = useBranches(activeRepoPath);
  const currentBranch = checkedOutBranch(branches);
  const rows = useMemo(() => orderForBranch(data ?? [], currentBranch), [data, currentBranch]);

  const handleRefresh = async () => {
    if (!repoPath || !accountId) return;
    setRefreshing(true);
    try {
      await refresh(repoPath, accountId, filter, selectedNumber);
    } finally {
      setRefreshing(false);
    }
  };

  let body;
  if (!accountId) {
    body = <PrPlaceholder icon={UserX} title={t("pr.noAccount")} />;
  } else if (!hasRemote || !repoUrl) {
    body = <PrPlaceholder icon={WifiOff} title={t("pr.noGitHubRemote")} />;
  } else if (isLoading) {
    body = <PrLoading />;
  } else if (isError) {
    body = <PrError error={error} onRetry={() => void refetch()} />;
  } else if (rows.length === 0) {
    body = <PrPlaceholder icon={GitPullRequest} title={t(`pr.empty.${filter}`)} />;
  } else {
    body = (
      <PrList
        rows={rows}
        selectedNumber={selectedNumber}
        onSelect={(n) => activeRepoPath && select(activeRepoPath, n)}
      />
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-(--line) shrink-0">
        <div role="radiogroup" aria-label={t("pr.filterLabel")} className="flex items-center gap-0.5 p-0.5 rounded-(--radius-chip) bg-(--chip)">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                "h-5 px-2 rounded-[5px] text-[11px] font-semibold transition-colors",
                filter === f ? "bg-card text-foreground shadow-(--shadow-sm)" : "text-(--fg2) hover:text-foreground",
              )}
            >
              {t(`pr.filter.${f}`)}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void handleRefresh()}
          disabled={!repoPath || !accountId || refreshing}
          aria-busy={refreshing}
          title={t("pr.refresh")}
          aria-label={t("pr.refresh")}
          className="flex items-center justify-center w-6 h-6 rounded-(--radius-item) text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 transition-colors"
        >
          <BusyIcon busy={refreshing} icon={<RefreshCw className="w-3.5 h-3.5" />} />
        </button>
        {repoUrl && (
          <button
            type="button"
            onClick={() => actions.openInBrowser(`${repoUrl}/pulls`)}
            title={t("pr.openListOnGitHub")}
            aria-label={t("pr.openListOnGitHub")}
            className="flex items-center justify-center w-6 h-6 rounded-(--radius-item) text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <Globe className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {body}
    </div>
  );
}

function PrList({
  rows,
  selectedNumber,
  onSelect,
}: {
  rows: { pr: PullRequestSummary; isCurrent: boolean }[];
  selectedNumber: number | null;
  onSelect: (number: number) => void;
}) {
  const menu = usePrMenu();
  const selectedIndex = rows.findIndex((r) => r.pr.number === selectedNumber);
  const { activeIndex, containerProps, itemRef } = useListKeyboardNav({
    items: rows,
    onSelect: (r) => onSelect(r.pr.number),
    selectedIndex,
  });
  return (
    <div className="flex-1 min-h-0 overflow-y-auto" role="listbox" {...containerProps}>
      {rows.map(({ pr, isCurrent }, index) => (
        <PrListItem
          key={pr.number}
          ref={itemRef(index)}
          pr={pr}
          isCurrent={isCurrent}
          isSelected={pr.number === selectedNumber}
          isHighlighted={index === activeIndex}
          onClick={() => onSelect(pr.number)}
          onContextMenu={(e) => {
            e.preventDefault();
            onSelect(pr.number);
            menu.open(pr, contextMenuPoint(e));
          }}
        />
      ))}
      {menu.element}
    </div>
  );
}

interface PrListItemProps {
  pr: PullRequestSummary;
  isCurrent: boolean;
  isSelected: boolean;
  isHighlighted: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  ref?: React.Ref<HTMLButtonElement>;
}

export function PrListItem({ pr, isCurrent, isSelected, isHighlighted, onClick, onContextMenu, ref }: PrListItemProps) {
  const { t } = useTranslation();
  const talk = pr.commentCount + pr.threadCount;
  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={isSelected}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cn(
        "w-full flex items-start gap-2.5 px-3 py-2 text-left border-b border-(--line) select-none transition-colors",
        isSelected ? "bg-(--acc-sel)" : isHighlighted ? "bg-accent ring-1 ring-primary/30" : "hover:bg-accent",
      )}
    >
      <PrStateIcon pr={pr} className="mt-0.5" />
      <span className="flex-1 min-w-0 flex flex-col gap-1">
        <span className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-[12.5px] font-semibold text-foreground truncate">{pr.title}</span>
          <span className="text-[11px] text-(--faint) shrink-0">#{pr.number}</span>
          {isCurrent && (
            <span className="shrink-0 h-[16px] px-1.5 rounded-(--radius-chip) bg-primary/15 text-primary text-[10px] font-bold leading-[16px]">
              {t("pr.currentBranch")}
            </span>
          )}
        </span>
        <span className="flex items-center gap-1.5 min-w-0 text-[11px] text-muted-foreground">
          <PrAvatar login={pr.author.login} url={pr.author.avatarUrl} size={14} />
          <span className="shrink-0 font-medium text-(--fg2)">{pr.author.login}</span>
          <BranchPair pr={pr} className="min-w-0" />
          <span className="flex-1" />
          <TimeAgo iso={pr.updatedAt} className="shrink-0" />
        </span>
        {(pr.isDraft || pr.reviewDecision || pr.ciState || talk > 0) && (
          <span className="flex items-center gap-1 flex-wrap">
            {pr.isDraft && pr.state === "open" && <DraftChip />}
            {pr.reviewDecision && <ReviewDecisionChip decision={pr.reviewDecision} />}
            {pr.ciState && <CiChip state={pr.ciState} />}
            {talk > 0 && (
              <span
                className="inline-flex items-center gap-0.5 text-[10.5px] text-muted-foreground"
                title={t("pr.commentCount", { count: talk })}
              >
                <MessageSquare className="w-3 h-3" />
                {talk}
              </span>
            )}
          </span>
        )}
      </span>
    </button>
  );
}

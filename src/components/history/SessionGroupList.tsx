import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { CommitItem } from "@/components/history/CommitItem";
import { SessionGroupHeader } from "@/components/history/SessionGroupHeader";
import { UNLINKED_GROUP_KEY, type SessionGrouping } from "@/components/history/session-groups";
import type { CommitInfo } from "@/types";

interface SessionGroupListProps extends SessionGrouping {
  repoPath: string;
  selectedCommitId: string | null;
  onSelectCommit: (commitId: string) => void;
  /** V30 — show this session's cumulative net diff in the content area. */
  onOpenSession: (sessionPath: string) => void;
  /** Passed through so a grouped row renders identically to a flat one. */
  remoteTags?: Set<string> | null;
  resolveAvatarUrl?: (commit: CommitInfo) => string | undefined;
  /** Per-commit trailing slot, so grouped rows keep the badges the flat list has. */
  renderCommitTrailing?: (commit: CommitInfo) => ReactNode;
}

/**
 * History bucketed by the agent session that produced each commit (V30).
 *
 * Groups start collapsed: the header's three lines are the point, and the
 * commits below them are the detail you open once a header has earned it.
 */
export function SessionGroupList({
  repoPath,
  groups,
  unlinked,
  selectedCommitId,
  onSelectCommit,
  onOpenSession,
  remoteTags,
  resolveAvatarUrl,
  renderCommitTrailing,
}: SessionGroupListProps) {
  const { t } = useTranslation();
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(new Set());

  const toggle = (key: string) =>
    setExpandedKeys((keys) => {
      const next = new Set(keys);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const renderCommits = (commits: CommitInfo[]) =>
    commits.map((commit) => (
      <CommitItem
        key={commit.id}
        commit={commit}
        remoteTags={remoteTags}
        avatarUrl={resolveAvatarUrl?.(commit)}
        isSelected={selectedCommitId === commit.id}
        onClick={() => onSelectCommit(commit.id)}
        trailing={renderCommitTrailing?.(commit)}
      />
    ));

  const isUnlinkedExpanded = expandedKeys.has(UNLINKED_GROUP_KEY);

  return (
    <div>
      {groups.map((group) => (
        <div key={group.key}>
          <SessionGroupHeader
            repoPath={repoPath}
            group={group}
            isExpanded={expandedKeys.has(group.key)}
            onToggle={() => toggle(group.key)}
            onOpenSession={() => onOpenSession(group.session.filePath)}
          />
          {expandedKeys.has(group.key) && renderCommits(group.commits)}
        </div>
      ))}

      {/* Commits no session confidently claims. They are listed rather than
          dropped — an unattributed commit still has to be reviewable (§7-⑧). */}
      {unlinked.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => toggle(UNLINKED_GROUP_KEY)}
            aria-expanded={isUnlinkedExpanded}
            className="flex w-full items-center gap-1.5 border-b border-border bg-surface px-2 py-1.5 text-left transition-colors hover:bg-accent"
          >
            <ChevronDown
              className={cn(
                "h-3 w-3 shrink-0 text-muted-foreground transition-transform",
                !isUnlinkedExpanded && "-rotate-90",
              )}
            />
            <span className="truncate text-xs font-medium text-muted-foreground">
              {t("history.session.unlinked")}
            </span>
            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground tabular-nums">
              {t("history.session.unlinkedCount", { count: unlinked.length })}
            </span>
          </button>
          {isUnlinkedExpanded && renderCommits(unlinked)}
        </div>
      )}
    </div>
  );
}

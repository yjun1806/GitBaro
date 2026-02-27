import { useState } from "react";
import { GitBranch, Search, Plus, ChevronRight, Check, FolderGit2, Trash2, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { BranchInfo, WorktreeInfo } from "@/types";

interface BranchDropdownProps {
  branches: BranchInfo[];
  currentBranch: string | null;
  worktrees: WorktreeInfo[];
  onSwitch: (branchName: string) => void;
  onCreateBranch: () => void;
  onCreateWorktree: () => void;
  onRemoveWorktree: (path: string) => void;
  onClose: () => void;
}

export function BranchDropdown({
  branches,
  currentBranch,
  worktrees,
  onSwitch,
  onCreateBranch,
  onCreateWorktree,
  onRemoveWorktree,
  onClose,
}: BranchDropdownProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [remoteExpanded, setRemoteExpanded] = useState(false);

  const lowerQuery = query.toLowerCase();
  const filtered = branches.filter((b) =>
    b.name.toLowerCase().includes(lowerQuery),
  );

  // 메인 worktree 제외 (삭제 불가)
  const nonMainWorktrees = worktrees.filter((w) => !w.isMain);

  // 로컬 브랜치가 추적하는 remote 이름 수집
  const trackedRemotes = new Set(
    branches
      .filter((b) => !b.isRemote && b.upstream)
      .map((b) => b.upstream!),
  );

  // 섹션 분류
  const defaultBranch = filtered.find((b) => !b.isRemote && b.isDefault);
  const recentBranches = filtered.filter(
    (b) => !b.isRemote && !b.isDefault,
  );
  const remoteOnly = filtered.filter(
    (b) => b.isRemote && !trackedRemotes.has(b.name),
  );

  const handleSelect = (branch: BranchInfo) => {
    if (branch.name !== currentBranch) {
      onSwitch(branch.name);
    }
    onClose();
  };

  return (
    <div
      className="absolute left-0 top-full mt-2 w-96 bg-popover border border-border rounded-xl shadow-xl z-50 overflow-hidden"
    >
      {/* Search */}
      <div className="p-2 border-b border-border">
        <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-surface border border-border focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20 transition-all">
          <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("branch.filterBranches")}
            className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* Branch list */}
      <div className="max-h-80 overflow-y-auto">
        {/* Default Branch */}
        {defaultBranch && (
          <div className="py-1">
            <SectionLabel label={t("branch.defaultBranch")} />
            <BranchRow
              branch={defaultBranch}
              isCurrent={defaultBranch.name === currentBranch}
              onSelect={() => handleSelect(defaultBranch)}
            />
          </div>
        )}

        {/* Recent Branches */}
        {recentBranches.length > 0 && (
          <div className={cn("py-1", defaultBranch && "border-t border-border")}>
            <SectionLabel label={t("branch.recentBranches")} />
            {recentBranches.map((branch) => (
              <BranchRow
                key={branch.name}
                branch={branch}
                isCurrent={branch.name === currentBranch}
                onSelect={() => handleSelect(branch)}
              />
            ))}
          </div>
        )}

        {/* Remote-only branches */}
        {remoteOnly.length > 0 && (
          <div className="py-1 border-t border-border">
            <button
              onClick={() => setRemoteExpanded((v) => !v)}
              className="w-full flex items-center gap-1.5 px-3 pt-1.5 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
            >
              <ChevronRight
                className={cn(
                  "w-3 h-3 transition-transform duration-150",
                  remoteExpanded && "rotate-90",
                )}
              />
              {t("branch.remote")} ({remoteOnly.length})
            </button>
            {remoteExpanded &&
              remoteOnly.map((branch) => (
                <BranchRow
                  key={branch.name}
                  branch={branch}
                  isCurrent={false}
                  onSelect={() => {
                    onSwitch(branch.name);
                    onClose();
                  }}
                />
              ))}
          </div>
        )}

        {!defaultBranch && recentBranches.length === 0 && remoteOnly.length === 0 && (
          <div className="py-6 text-center">
            <p className="text-sm text-muted-foreground">{t("branch.noBranches")}</p>
          </div>
        )}

        {/* Worktrees */}
        {nonMainWorktrees.length > 0 && (
          <WorktreeSection
            worktrees={nonMainWorktrees}
            onRemove={onRemoveWorktree}
          />
        )}
      </div>

      {/* New branch + New worktree */}
      <div className="border-t border-border">
        <button
          onClick={() => {
            onCreateBranch();
            onClose();
          }}
          className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-primary hover:bg-primary/5 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t("branch.newBranch")}
        </button>
        <button
          onClick={() => {
            onCreateWorktree();
            onClose();
          }}
          className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-primary hover:bg-primary/5 transition-colors"
        >
          <FolderGit2 className="w-4 h-4" />
          {t("worktree.newWorktree")}
        </button>
      </div>
    </div>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <p className="px-3 pt-1.5 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
      {label}
    </p>
  );
}

function BranchRow({
  branch,
  isCurrent,
  onSelect,
}: {
  branch: BranchInfo;
  isCurrent: boolean;
  onSelect: () => void;
}) {
  const hasAheadBehind = branch.aheadBehind &&
    (branch.aheadBehind.ahead > 0 || branch.aheadBehind.behind > 0);

  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors group",
        isCurrent
          ? "bg-primary/8 text-primary"
          : "hover:bg-accent",
      )}
    >
      <GitBranch className={cn(
        "w-3.5 h-3.5 shrink-0",
        isCurrent ? "text-primary" : "text-muted-foreground",
      )} />
      <span className="flex-1 truncate text-left">{branch.name}</span>
      {hasAheadBehind && (
        <span className="flex items-center gap-1.5 text-xs tabular-nums shrink-0">
          {branch.aheadBehind!.ahead > 0 && (
            <span className="text-primary font-medium">
              {"\u2191"}{branch.aheadBehind!.ahead}
            </span>
          )}
          {branch.aheadBehind!.behind > 0 && (
            <span className="text-danger font-medium">
              {"\u2193"}{branch.aheadBehind!.behind}
            </span>
          )}
        </span>
      )}
      {branch.lastCommitTime != null && (
        <span className="text-xs text-muted-foreground shrink-0">
          {formatRelativeTime(branch.lastCommitTime)}
        </span>
      )}
      {isCurrent && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
    </button>
  );
}

function WorktreeSection({
  worktrees,
  onRemove,
}: {
  worktrees: WorktreeInfo[];
  onRemove: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  return (
    <div className="py-1 border-t border-border">
      <SectionLabel label={t("worktree.title")} />
      {worktrees.map((wt) => (
        <div key={wt.path} className="relative group">
          <div className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent transition-colors">
            <FolderGit2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-foreground truncate" title={wt.path}>
                {wt.path.split("/").pop()}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {wt.branch ?? t("worktree.detachedHead")}
              </p>
            </div>
            {wt.isLocked && (
              <span title={wt.lockReason ?? t("worktree.locked")}>
                <Lock className="w-3 h-3 text-warning shrink-0" />
              </span>
            )}
            {!wt.isLocked && (
              <button
                onClick={() => setConfirmRemove(wt.path)}
                className="p-1 rounded text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
                title={t("worktree.remove")}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Inline confirm */}
          {confirmRemove === wt.path && (
            <div className="absolute inset-x-0 bottom-full mb-1 mx-2 bg-card border border-border rounded-lg shadow-lg p-3 z-10">
              <p className="text-sm text-foreground mb-2">
                {t("worktree.removeConfirm", { path: wt.path.split("/").pop() })}
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setConfirmRemove(null)}
                  className="px-3 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t("common.cancel")}
                </button>
                <button
                  onClick={() => {
                    onRemove(wt.path);
                    setConfirmRemove(null);
                  }}
                  className="px-3 py-1 text-xs bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded transition-colors"
                >
                  {t("common.delete")}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

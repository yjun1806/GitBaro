import { useReducer, useState, useCallback } from "react";
import {
  GitBranch,
  Search,
  Plus,
  FolderGit2,
  Trash2,
  Lock,
  Eye,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useBranchGroups } from "@/hooks/useBranchGroups";
import type { SortBy } from "@/hooks/useBranchGroups";
import {
  BranchTabContent,
  getFlatBranchCount,
  getBranchAtIndex,
} from "@/components/branch/BranchTabContent";
import { BranchContextMenu } from "@/components/branch/BranchContextMenu";
import type { BranchInfo, WorktreeInfo } from "@/types";

type Tab = "branches" | "worktrees";

// ── Reducer ─────────────────────────────────────────────────────────────────

type DropdownState = {
  query: string;
  activeIndex: number;
  contextMenu: {
    branch: BranchInfo;
    x: number;
    y: number;
  } | null;
};

type DropdownAction =
  | { type: "SET_QUERY"; query: string }
  | { type: "NAVIGATE"; direction: "up" | "down"; total: number }
  | {
      type: "OPEN_CONTEXT_MENU";
      branch: BranchInfo;
      x: number;
      y: number;
    }
  | { type: "CLOSE_CONTEXT_MENU" }
  | { type: "RESET" };

function reducer(state: DropdownState, action: DropdownAction): DropdownState {
  switch (action.type) {
    case "SET_QUERY":
      return { ...state, query: action.query, activeIndex: 0 };
    case "NAVIGATE": {
      if (action.total === 0) return state;
      const next =
        action.direction === "down"
          ? (state.activeIndex + 1) % action.total
          : (state.activeIndex - 1 + action.total) % action.total;
      return { ...state, activeIndex: next };
    }
    case "OPEN_CONTEXT_MENU":
      return {
        ...state,
        contextMenu: {
          branch: action.branch,
          x: action.x,
          y: action.y,
        },
      };
    case "CLOSE_CONTEXT_MENU":
      return { ...state, contextMenu: null };
    case "RESET":
      return { query: "", activeIndex: 0, contextMenu: null };
    default:
      return state;
  }
}

// ── Props ───────────────────────────────────────────────────────────────────

interface BranchDropdownProps {
  branches: BranchInfo[];
  currentBranch: string | null;
  recentBranchNames: string[];
  worktrees: WorktreeInfo[];
  previewBranch: string | null;
  onSwitch: (branchName: string) => void;
  onCreateBranch: () => void;
  onCreateWorktree: () => void;
  onOpenWorktree: (path: string) => void;
  onRemoveWorktree: (path: string) => void;
  onStartPreview: (branch: string) => void;
  onDelete: (branchName: string) => void;
  onRename: (branchName: string) => void;
  onCompare: (branchName: string) => void;
  onMerge: (branchName: string) => void;
  onCopyName: (branchName: string) => void;
  onClose: () => void;
}

// ── Component ───────────────────────────────────────────────────────────────

export function BranchDropdown({
  branches,
  currentBranch,
  recentBranchNames,
  worktrees,
  previewBranch,
  onSwitch,
  onCreateBranch,
  onCreateWorktree,
  onOpenWorktree,
  onRemoveWorktree,
  onStartPreview,
  onDelete,
  onRename,
  onCompare,
  onMerge,
  onCopyName,
  onClose,
}: BranchDropdownProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>("branches");
  const [sortBy, setSortBy] = useState<SortBy>("name");
  const [state, dispatch] = useReducer(reducer, {
    query: "",
    activeIndex: 0,
    contextMenu: null,
  });

  const groups = useBranchGroups(
    branches,
    recentBranchNames,
    state.query,
    sortBy,
  );

  const flatCount = getFlatBranchCount(groups);

  const handleSelect = useCallback(
    (branch: BranchInfo) => {
      if (branch.name !== currentBranch) {
        onSwitch(branch.name);
      }
      onClose();
    },
    [currentBranch, onSwitch, onClose],
  );

  const handleContextMenu = useCallback(
    (branch: BranchInfo, e: React.MouseEvent) => {
      dispatch({
        type: "OPEN_CONTEXT_MENU",
        branch,
        x: e.clientX,
        y: e.clientY,
      });
    },
    [],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (activeTab !== "branches") return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          dispatch({ type: "NAVIGATE", direction: "down", total: flatCount });
          break;
        case "ArrowUp":
          e.preventDefault();
          dispatch({ type: "NAVIGATE", direction: "up", total: flatCount });
          break;
        case "Enter": {
          e.preventDefault();
          const branch = getBranchAtIndex(groups, state.activeIndex);
          if (branch) handleSelect(branch);
          break;
        }
        case "Escape":
          e.preventDefault();
          if (state.contextMenu) {
            dispatch({ type: "CLOSE_CONTEXT_MENU" });
          } else {
            onClose();
          }
          break;
      }
    },
    [activeTab, flatCount, groups, state.activeIndex, state.contextMenu, handleSelect, onClose],
  );

  const activeWorktrees = worktrees.filter((w) => !w.isBare);
  const filteredWorktrees = activeWorktrees.filter((w) =>
    (w.branch ?? w.path).toLowerCase().includes(state.query.toLowerCase()),
  );

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className="absolute left-2 top-full mt-2 w-[28rem] bg-popover border border-border rounded-xl shadow-xl z-50 overflow-hidden"
      onKeyDown={handleKeyDown}
    >
      {/* Tabs */}
      <div className="flex border-b border-border">
        <TabButton
          active={activeTab === "branches"}
          onClick={() => setActiveTab("branches")}
          icon={<GitBranch className="w-3.5 h-3.5" />}
          label={t("branch.title")}
          count={branches.filter((b) => !b.isRemote).length}
        />
        <TabButton
          active={activeTab === "worktrees"}
          onClick={() => setActiveTab("worktrees")}
          icon={<FolderGit2 className="w-3.5 h-3.5" />}
          label={t("worktree.title")}
          count={activeWorktrees.length}
        />
      </div>

      {/* Search */}
      <div className="p-2 border-b border-border">
        <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-surface border border-border focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20 transition-all">
          <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            autoFocus
            type="text"
            value={state.query}
            onChange={(e) =>
              dispatch({ type: "SET_QUERY", query: e.target.value })
            }
            placeholder={
              activeTab === "branches"
                ? t("branch.filterBranches")
                : t("worktree.filterWorktrees")
            }
            className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* Content */}
      <div className="max-h-80 overflow-y-auto">
        {activeTab === "branches" ? (
          <BranchTabContent
            groups={groups}
            currentBranch={currentBranch}
            activeIndex={state.activeIndex}
            sortBy={sortBy}
            onSortChange={setSortBy}
            onSelect={handleSelect}
            onContextMenu={handleContextMenu}
          />
        ) : (
          <WorktreeTabContent
            worktrees={filteredWorktrees}
            previewBranch={previewBranch}
            onOpen={(path) => {
              onOpenWorktree(path);
              onClose();
            }}
            onRemove={onRemoveWorktree}
            onPreview={(branch) => {
              onStartPreview(branch);
              onClose();
            }}
          />
        )}
      </div>

      {/* Action button */}
      <div className="border-t border-border">
        {activeTab === "branches" ? (
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
        ) : (
          <button
            onClick={() => {
              onCreateWorktree();
              onClose();
            }}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-primary hover:bg-primary/5 transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t("worktree.newWorktree")}
          </button>
        )}
      </div>

      {/* Context Menu */}
      {state.contextMenu && (
        <BranchContextMenu
          isCurrent={state.contextMenu.branch.name === currentBranch}
          isDefault={state.contextMenu.branch.isDefault}
          position={{ x: state.contextMenu.x, y: state.contextMenu.y }}
          onCheckout={() => {
            handleSelect(state.contextMenu!.branch);
            dispatch({ type: "CLOSE_CONTEXT_MENU" });
          }}
          onCompare={() => {
            onCompare(state.contextMenu!.branch.name);
            dispatch({ type: "CLOSE_CONTEXT_MENU" });
            onClose();
          }}
          onMerge={() => {
            onMerge(state.contextMenu!.branch.name);
            dispatch({ type: "CLOSE_CONTEXT_MENU" });
            onClose();
          }}
          onRename={() => {
            onRename(state.contextMenu!.branch.name);
            dispatch({ type: "CLOSE_CONTEXT_MENU" });
          }}
          onDelete={() => {
            onDelete(state.contextMenu!.branch.name);
            dispatch({ type: "CLOSE_CONTEXT_MENU" });
          }}
          onCopyName={() => {
            onCopyName(state.contextMenu!.branch.name);
            dispatch({ type: "CLOSE_CONTEXT_MENU" });
          }}
          onClose={() => dispatch({ type: "CLOSE_CONTEXT_MENU" })}
        />
      )}
    </div>
  );
}

// ── TabButton ───────────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-medium transition-colors relative",
        active
          ? "text-primary"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
      <span
        className={cn(
          "text-xs tabular-nums px-1.5 py-0.5 rounded-full",
          active
            ? "bg-primary/10 text-primary"
            : "bg-muted text-muted-foreground",
        )}
      >
        {count}
      </span>
      {active && (
        <span className="absolute bottom-0 inset-x-3 h-0.5 bg-primary rounded-full" />
      )}
    </button>
  );
}

// ── WorktreeTabContent ──────────────────────────────────────────────────────
// Kept inline — not complex enough to warrant its own file

function WorktreeTabContent({
  worktrees,
  previewBranch,
  onOpen,
  onRemove,
  onPreview,
}: {
  worktrees: WorktreeInfo[];
  previewBranch: string | null;
  onOpen: (path: string) => void;
  onRemove: (path: string) => void;
  onPreview: (branch: string) => void;
}) {
  const { t } = useTranslation();
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  if (worktrees.length === 0) {
    return (
      <div className="py-6 text-center">
        <p className="text-sm text-muted-foreground">
          {t("worktree.noWorktrees")}
        </p>
      </div>
    );
  }

  return (
    <div className="py-1">
      {worktrees.map((wt) => {
        const isPreviewing = previewBranch === wt.branch;
        return (
          <div key={wt.path} className="relative group">
            <div className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent transition-colors">
              <button
                onClick={() => onOpen(wt.path)}
                className="flex items-center gap-2 flex-1 min-w-0 text-left"
              >
                <FolderGit2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm text-foreground truncate"
                    title={wt.path}
                  >
                    {wt.path.split("/").pop()}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {wt.branch ?? t("worktree.detachedHead")}
                  </p>
                </div>
              </button>
              {wt.isMain && (
                <span className="text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
                  {t("worktree.main")}
                </span>
              )}
              {!wt.isMain && wt.branch && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isPreviewing) onPreview(wt.branch!);
                  }}
                  className={cn(
                    "p-1 rounded transition-colors shrink-0",
                    isPreviewing
                      ? "text-warning bg-warning/15"
                      : "text-muted-foreground/50 hover:text-warning hover:bg-warning/10 opacity-0 group-hover:opacity-100",
                  )}
                  title={t("preview.start")}
                >
                  <Eye className="w-3.5 h-3.5" />
                </button>
              )}
              {!wt.isMain && wt.isLocked && (
                <span title={wt.lockReason ?? t("worktree.locked")}>
                  <Lock className="w-3 h-3 text-warning shrink-0" />
                </span>
              )}
              {!wt.isMain && !wt.isLocked && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmRemove(wt.path);
                  }}
                  className="p-1 rounded text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
                  title={t("worktree.remove")}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {confirmRemove === wt.path && (
              <div className="absolute inset-x-0 bottom-full mb-1 mx-2 bg-card border border-border rounded-lg shadow-lg p-3 z-10">
                <p className="text-sm text-foreground mb-2">
                  {t("worktree.removeConfirm", {
                    path: wt.path.split("/").pop(),
                  })}
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
        );
      })}
    </div>
  );
}

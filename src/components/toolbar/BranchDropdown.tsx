import { useReducer, useState, useCallback } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useBranchGroups } from "@/hooks/useBranchGroups";
import type { SortBy } from "@/hooks/useBranchGroups";
import {
  BranchTabContent,
  getFlatBranchCount,
  getBranchAtIndex,
} from "@/components/branch/BranchTabContent";
import { BranchContextMenu } from "@/components/branch/BranchContextMenu";
import type { BranchInfo, WorktreeInfo } from "@/types";

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
      return { ...state, query: action.query, activeIndex: -1 };
    case "NAVIGATE": {
      if (action.total === 0) return state;
      const next =
        state.activeIndex < 0
          ? action.direction === "down" ? 0 : action.total - 1
          : action.direction === "down"
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
      return { query: "", activeIndex: -1, contextMenu: null };
    default:
      return state;
  }
}

// ── Props ───────────────────────────────────────────────────────────────────

interface BranchDropdownProps {
  branches: BranchInfo[];
  currentBranch: string | null;
  recentBranchNames: string[];
  worktreeByBranch: Map<string, WorktreeInfo>;
  onSwitch: (branchName: string) => void;
  onCreateBranch: () => void;
  onOpenWorktree: (path: string) => void;
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
  worktreeByBranch,
  onSwitch,
  onCreateBranch,
  onOpenWorktree,
  onDelete,
  onRename,
  onCompare,
  onMerge,
  onCopyName,
  onClose,
}: BranchDropdownProps) {
  const { t } = useTranslation();
  const [sortBy, setSortBy] = useState<SortBy>("name");
  const [state, dispatch] = useReducer(reducer, {
    query: "",
    activeIndex: -1,
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
      // 워크트리에 체크아웃된 브랜치는 git상 전환 불가 → 해당 워크트리로 이동.
      const wt = worktreeByBranch.get(branch.name);
      if (wt && !wt.isMain) {
        onOpenWorktree(wt.path);
      } else if (branch.name !== currentBranch) {
        onSwitch(branch.name);
      }
      onClose();
    },
    [currentBranch, onSwitch, onClose, worktreeByBranch, onOpenWorktree],
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
    [flatCount, groups, state.activeIndex, state.contextMenu, handleSelect, onClose],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      className="flex flex-col h-full overflow-hidden"
      onKeyDown={handleKeyDown}
    >
      {/* Search + Action */}
      <div className="flex items-center gap-2 p-2 border-b border-border">
        <div className="flex-1 flex items-center gap-2 px-2.5 py-2 rounded-lg bg-surface border border-border focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20 transition-all">
          <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            autoFocus
            type="text"
            value={state.query}
            onChange={(e) =>
              dispatch({ type: "SET_QUERY", query: e.target.value })
            }
            placeholder={t("branch.filterBranches")}
            className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
          />
        </div>
        <button
          onClick={() => {
            onCreateBranch();
            onClose();
          }}
          className="shrink-0 px-3 py-2 text-sm font-medium text-primary-foreground bg-primary hover:bg-primary-hover rounded-lg transition-colors"
        >
          {t("branch.newBranch")}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <BranchTabContent
          groups={groups}
          currentBranch={currentBranch}
          activeIndex={state.activeIndex}
          sortBy={sortBy}
          worktreeByBranch={worktreeByBranch}
          onSortChange={setSortBy}
          onSelect={handleSelect}
          onContextMenu={handleContextMenu}
        />
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

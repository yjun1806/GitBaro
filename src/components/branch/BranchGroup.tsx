import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { BranchRow } from "./BranchRow";
import type { BranchInfo, WorktreeInfo } from "@/types";

interface BranchGroupProps {
  label: string;
  branches: BranchInfo[];
  currentBranch: string | null;
  activeIndex: number | null;
  startIndex: number;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  count?: number;
  trailing?: React.ReactNode;
  worktreeByBranch?: Map<string, WorktreeInfo>;
  onSelect: (branch: BranchInfo) => void;
  onContextMenu?: (branch: BranchInfo, e: React.MouseEvent) => void;
}

export function BranchGroup({
  label,
  branches,
  currentBranch,
  activeIndex,
  startIndex,
  collapsible = false,
  defaultCollapsed = false,
  count,
  trailing,
  worktreeByBranch,
  onSelect,
  onContextMenu,
}: BranchGroupProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  if (branches.length === 0 && !collapsible) return null;

  return (
    <div className="py-1">
      {collapsible ? (
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="w-full flex items-center gap-1.5 px-3 pt-1.5 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
        >
          <ChevronRight
            className={cn(
              "w-3 h-3 transition-transform duration-150",
              !collapsed && "rotate-90",
            )}
          />
          {label}
          {count != null && ` (${count})`}
        </button>
      ) : (
        <div className="flex items-center gap-2 px-3 pt-1.5 pb-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex-1">
            {label}
          </p>
          {trailing}
        </div>
      )}

      {!collapsed &&
        branches.map((branch, i) => (
          <BranchRow
            key={branch.name}
            branch={branch}
            isCurrent={branch.name === currentBranch}
            isActive={activeIndex === startIndex + i}
            worktreeByBranch={worktreeByBranch}
            onSelect={() => onSelect(branch)}
            onContextMenu={(e) => onContextMenu?.(branch, e)}
          />
        ))}
    </div>
  );
}

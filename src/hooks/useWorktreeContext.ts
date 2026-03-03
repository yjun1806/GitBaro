import { useMemo } from "react";
import type { WorktreeInfo } from "@/types";

export function useWorktreeContext(
  activeRepoPath: string | null,
  worktrees: WorktreeInfo[],
) {
  return useMemo(() => {
    const currentWorktree = worktrees.find(
      (wt) => wt.path === activeRepoPath,
    );
    const isInWorktree = currentWorktree != null && !currentWorktree.isMain;
    const mainWorktree = worktrees.find((wt) => wt.isMain);
    const worktreeByBranch = new Map(
      worktrees.filter((w) => w.branch && !w.isMain).map((w) => [w.branch!, w]),
    );
    return { currentWorktree, isInWorktree, mainWorktree, worktreeByBranch };
  }, [activeRepoPath, worktrees]);
}

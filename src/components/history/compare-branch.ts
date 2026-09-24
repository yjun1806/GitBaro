import type { BranchInfo } from "@/types";

/**
 * True when the History compare target no longer exists (for example it was
 * deleted after a merge). Returns false while the branch list is still loading.
 */
export function isStaleCompareBranch(
  compareBranch: string | null,
  branches: readonly BranchInfo[] | undefined,
): boolean {
  if (!compareBranch || !branches) return false;
  return !branches.some((b) => b.name === compareBranch);
}

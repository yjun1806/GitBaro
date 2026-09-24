import type { BranchInfo } from "@/types";

export type BranchNameProblem = "invalid" | "exists";

function isValidBranchName(name: string): boolean {
  return /^[a-zA-Z0-9._/-]+$/.test(name) && !name.startsWith("/") && !name.endsWith("/");
}

/**
 * Checks a name typed for a new or renamed local branch. Returns null when it
 * can be used. `ignore` is the branch being renamed, whose own name is not a clash.
 */
export function checkNewBranchName(
  name: string,
  branches: BranchInfo[],
  ignore?: string,
): BranchNameProblem | null {
  if (!isValidBranchName(name)) return "invalid";
  const taken = branches.some((b) => !b.isRemote && b.name === name && b.name !== ignore);
  return taken ? "exists" : null;
}

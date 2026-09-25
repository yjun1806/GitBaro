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

/** 원격 브랜치 이름에서 원격 이름을 뗀다(`origin/feat/x` → `feat/x`). */
export function remoteShortName(remoteName: string): string {
  const slash = remoteName.indexOf("/");
  return slash >= 0 ? remoteName.slice(slash + 1) : remoteName;
}

/**
 * 체크아웃하면 실제로 전환될 브랜치 이름. 원격 브랜치(`origin/feat`)인데 같은 이름의
 * 로컬 브랜치(`feat`)가 있으면 백엔드(`switch_branch`)는 그 로컬 브랜치로 전환한다.
 * 지금 브랜치·다른 워크트리 비교는 이 이름으로 해야 한다.
 */
export function checkoutTargetName(name: string, branches: readonly BranchInfo[]): string {
  if (!branches.some((b) => b.isRemote && b.name === name)) return name;
  const short = remoteShortName(name);
  return branches.some((b) => !b.isRemote && b.name === short) ? short : name;
}

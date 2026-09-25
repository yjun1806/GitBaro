import { trimTrailingSlash } from "@/lib/utils";

/**
 * 새 워크트리 경로 제안: `<부모 폴더>/<저장소 폴더 이름>-<브랜치>`.
 * 부모 폴더는 앱 설정의 「워크트리를 만들 위치」, 없으면 저장소 폴더 옆.
 */
export function suggestWorktreePath(repoPath: string, branchName: string, parentOverride: string | null = null): string {
  const safeBranch = branchName.replace(/\//g, "-").replace(/^-+|-+$/g, "");
  if (!safeBranch) return "";
  const lastSlash = repoPath.lastIndexOf("/");
  const parentDir = parentOverride ? trimTrailingSlash(parentOverride) : lastSlash > 0 ? repoPath.slice(0, lastSlash) : repoPath;
  const repoName = repoPath.slice(lastSlash + 1);
  return `${parentDir}/${repoName}-${safeBranch}`;
}

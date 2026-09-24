import type { RepoInfo } from "@/types";

/** origin이 github.com/<owner>/<name>인 저장소. owner가 없으면 원격 없는 로컬 저장소. */
export function makeRepo(
  name: string,
  owner: string | null,
  overrides: Partial<RepoInfo> = {},
): RepoInfo {
  return {
    path: `/repos/${name}`,
    name,
    currentBranch: "main",
    isDirty: false,
    remotes: owner ? [{ name: "origin", url: `https://github.com/${owner}/${name}.git` }] : [],
    accountId: null,
    ...overrides,
  };
}

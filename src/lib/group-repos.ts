import type { RepoInfo } from "@/types";

/** 저장소를 GitHub owner(또는 계정/로컬) 기준으로 묶은 그룹 */
export interface GroupedRepos {
  label: string;
  repos: RepoInfo[];
}

/** origin remote URL에서 GitHub owner 이름을 뽑는다 (https/ssh 모두 지원). */
export function extractOwnerFromRemoteUrl(url: string): string | null {
  const httpsMatch = url.match(/github\.com\/([^/]+)\//);
  if (httpsMatch) return httpsMatch[1];
  const sshMatch = url.match(/github\.com:([^/]+)\//);
  if (sshMatch) return sshMatch[1];
  return null;
}

/**
 * 저장소를 owner 기준으로 그룹핑한다.
 * owner를 못 찾으면 연결된 계정 username, 그것도 없으면 "Local"로 묶는다.
 * 그룹 순서는 처음 등장한 순서를 따른다.
 */
export function groupReposByOwner(
  repos: RepoInfo[],
  accounts: { id: string; username: string }[],
): GroupedRepos[] {
  const accountMap = new Map(accounts.map((a) => [a.id, a.username]));
  const groups = new Map<string, RepoInfo[]>();

  for (const repo of repos) {
    const originRemote = repo.remotes.find((r) => r.name === "origin");
    const owner = originRemote ? extractOwnerFromRemoteUrl(originRemote.url) : null;
    const key =
      owner ?? (repo.accountId ? (accountMap.get(repo.accountId) ?? "Other") : "Local");

    const existing = groups.get(key) ?? [];
    groups.set(key, [...existing, repo]);
  }

  return Array.from(groups.entries()).map(([label, repoList]) => ({
    label,
    repos: repoList,
  }));
}

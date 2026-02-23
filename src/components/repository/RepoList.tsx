import { useState } from "react";
import { Search, FolderGit2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { RepoInfo, GitHubAccount } from "@/types";
import { RepoCard } from "./RepoCard";

interface RepoGroup {
  account: GitHubAccount | null;
  repos: RepoInfo[];
}

interface RepoListProps {
  repos: RepoInfo[];
  accounts: GitHubAccount[];
  selectedRepoPath?: string;
  onSelectRepo: (repo: RepoInfo) => void;
}

function groupReposByAccount(
  repos: RepoInfo[],
  accounts: GitHubAccount[]
): RepoGroup[] {
  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const grouped = new Map<string | null, RepoInfo[]>();

  for (const repo of repos) {
    const key = repo.accountId ?? null;
    const existing = grouped.get(key) ?? [];
    grouped.set(key, [...existing, repo]);
  }

  return Array.from(grouped.entries()).map(([accountId, groupRepos]) => ({
    account: accountId ? (accountMap.get(accountId) ?? null) : null,
    repos: groupRepos,
  }));
}

export function RepoList({
  repos,
  accounts,
  selectedRepoPath,
  onSelectRepo,
}: RepoListProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");

  const filtered = repos.filter((r) =>
    r.name.toLowerCase().includes(query.toLowerCase())
  );

  const groups = groupReposByAccount(filtered, accounts);
  const accountMap = new Map(accounts.map((a) => [a.id, a]));

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="px-2 py-2 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-gray-100 dark:bg-gray-800">
          <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("repo.search")}
            className="flex-1 bg-transparent text-sm text-gray-700 dark:text-gray-200 placeholder-gray-400 outline-none"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto py-2">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-gray-400">
            <FolderGit2 className="w-8 h-8" />
            <p className="text-sm">{t("repo.noRepos")}</p>
          </div>
        ) : (
          groups.map((group, i) => (
            <div key={i} className="mb-2">
              {group.account && (
                <p className="px-3 py-1 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                  {group.account.username}
                </p>
              )}
              <div className="px-1.5 flex flex-col gap-0.5">
                {group.repos.map((repo) => (
                  <RepoCard
                    key={repo.path}
                    repo={repo}
                    account={repo.accountId ? accountMap.get(repo.accountId) : undefined}
                    isSelected={repo.path === selectedRepoPath}
                    onClick={() => onSelectRepo(repo)}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

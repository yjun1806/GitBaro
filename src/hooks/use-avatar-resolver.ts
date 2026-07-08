import { useMemo } from "react";
import { useCommitAvatars } from "@/api/queries";
import { useAccountStore } from "@/stores/account";
import { useRepositoryStore } from "@/stores/repository";

/**
 * Resolve a commit author's avatar URL by email, preferring a configured
 * account's avatar over the GitHub/gravatar avatar derived from history.
 * Returns undefined when no avatar is known so callers can fall back to
 * initials. Backed by the cached `commitAvatars` query, so calling this from
 * many list rows shares one request.
 */
export function useAvatarResolver(): (email: string | null | undefined) => string | undefined {
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const accounts = useAccountStore((s) => s.accounts);
  const { data: githubAvatarMap = {} } = useCommitAvatars(activeRepoPath);

  const accountAvatarMap = useMemo(
    () => new Map(accounts.map((a) => [a.email.toLowerCase(), a.avatarUrl])),
    [accounts],
  );

  return useMemo(
    () => (email) => {
      if (!email) return undefined;
      const key = email.toLowerCase();
      return accountAvatarMap.get(key) || githubAvatarMap[key] || undefined;
    },
    [accountAvatarMap, githubAvatarMap],
  );
}

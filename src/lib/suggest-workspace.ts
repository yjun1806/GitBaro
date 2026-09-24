import { accountKeysByPath, type Workspace } from "@/lib/repo-tree";
import type { RepoInfo } from "@/types";

/** 이름 앞부분이 같은 저장소가 이만큼 모이면 워크스페이스를 제안한다. */
export const MIN_SUGGESTION_SIZE = 3;

export interface WorkspaceSuggestion {
  /** 닫은 제안을 기억하는 키(`<계정>/<앞부분>`). `dismissedSuggestions`에 남긴다. */
  key: string;
  accountKey: string;
  /** 제안하는 워크스페이스 이름(처음 나온 저장소의 앞부분 표기) */
  name: string;
  repoPaths: string[];
}

export interface SuggestWorkspaceOptions {
  accounts?: { id: string; username: string }[];
  /** 이미 워크스페이스에 든 저장소는 제안에서 뺀다. */
  workspaces?: Workspace[];
  dismissed?: string[];
}

/** 저장소 이름의 첫 `-` 앞부분. `-`가 없으면 이름 전체다(xames와 xames-app은 같은 앞부분). */
export function namePrefix(name: string): string {
  return name.split("-")[0].toLowerCase();
}

export function suggestionKey(accountKey: string, prefix: string): string {
  return `${accountKey}/${prefix}`;
}

/**
 * 같은 계정 안에서 이름 앞부분이 같은 저장소가 3개 이상이면 워크스페이스를 제안한다
 * (예: xames, xames-admin, xames-backend). 계정을 넘는 제안은 만들지 않는다.
 * 이미 워크스페이스에 든 저장소는 세지 않고, 닫은 제안은 다시 내지 않는다.
 */
export function suggestWorkspace(
  repos: RepoInfo[],
  { accounts = [], workspaces = [], dismissed = [] }: SuggestWorkspaceOptions = {},
): WorkspaceSuggestion[] {
  const keyByPath = accountKeysByPath(repos, accounts);
  const inWorkspace = new Set(workspaces.flatMap((w) => w.repoPaths));
  const dismissedSet = new Set(dismissed);

  const groups = new Map<string, { accountKey: string; name: string; paths: string[] }>();
  for (const repo of repos) {
    if (inWorkspace.has(repo.path)) continue;
    const prefix = namePrefix(repo.name);
    const accountKey = keyByPath.get(repo.path);
    if (!prefix || accountKey === undefined) continue;
    const key = suggestionKey(accountKey, prefix);
    // 이름은 처음 나온 저장소의 표기를 그대로 쓴다(대소문자 유지).
    const group = groups.get(key) ?? { accountKey, name: repo.name.split("-")[0], paths: [] };
    groups.set(key, { ...group, paths: [...group.paths, repo.path] });
  }

  return Array.from(groups.entries())
    .filter(([key, g]) => g.paths.length >= MIN_SUGGESTION_SIZE && !dismissedSet.has(key))
    .map(([key, g]) => ({
      key,
      accountKey: g.accountKey,
      name: g.name,
      repoPaths: g.paths,
    }));
}

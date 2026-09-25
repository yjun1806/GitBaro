import { useCallback } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createSafeStorage } from "@/lib/safe-storage";
import type { AutoSyncSetting, RepoInfo, StatusEntry } from "@/types";
import type { RepoVisibility } from "@/api/commands";

export interface RepoPermission {
  valid: boolean;
  /** null when push access cannot be checked (the remote is not on github.com). */
  canPush: boolean | null;
  reason?: string;
}

/**
 * activeRepoPath는 워크트리를 보는 중이면 저장소 경로가 아니라 워크트리 경로다.
 * 그래서 repos에서 바로 찾으면 못 찾는다. activeWorktrees를 역추적해 소유 저장소를 찾는다.
 */
export function findOwnerRepo(
  repos: RepoInfo[],
  activeRepoPath: string | null,
  activeWorktrees: Readonly<Record<string, string>>,
): RepoInfo | null {
  if (!activeRepoPath) return null;
  const ownerPath =
    Object.keys(activeWorktrees).find(
      (repoPath) => activeWorktrees[repoPath] === activeRepoPath,
    ) ?? activeRepoPath;
  return repos.find((r) => r.path === ownerPath) ?? null;
}

interface RepositoryState {
  repos: RepoInfo[];
  activeRepoPath: string | null;
  activeRepo: RepoInfo | null;
  statusEntries: StatusEntry[];
  isLoading: boolean;
  /** Cached GitHub visibility info per repo path */
  repoVisibility: Record<string, RepoVisibility>;
  /** Cached owner type: "User" | "Organization" per owner name */
  ownerTypes: Record<string, "User" | "Organization">;
  /** Cached token permission per repo path */
  repoPermissions: Record<string, RepoPermission>;
  /** Collapsed group labels in repo list */
  collapsedGroups: string[];
  /** Favorite repo paths */
  favoriteRepos: string[];
  /** 저장소별로 마지막에 보던 워크트리 경로 (메인 워크트리면 항목 없음) */
  activeWorktrees: Record<string, string>;
  /** 저장소별 원격 자동 최신화 설정. 항목이 없으면 기본값(확인만, 3분)이다. */
  autoSyncByRepo: Record<string, AutoSyncSetting>;
  /** 활성 경로를 그대로 설정한다. 워크트리라면 parentRepoPath로 소유 저장소를 알린다. */
  setActiveRepo: (path: string, parentRepoPath?: string) => void;
  /** 저장소에서 마지막으로 보던 워크트리를 기록한다. null이면 메인으로 되돌린다. */
  rememberWorktree: (repoPath: string, worktreePath: string | null) => void;
  /** 저장소를 활성화하되, 기억된 워크트리가 있으면 그 워크트리로 복원한다. */
  activateRepo: (repoPath: string) => void;
  /** 저장소 선택을 푼다. 워크스페이스를 고를 때 쓴다(선택은 둘 중 하나만 잡힌다). */
  clearActiveRepo: () => void;
  addRepo: (repo: RepoInfo) => void;
  removeRepo: (path: string) => void;
  setRepos: (repos: RepoInfo[]) => void;
  updateRepoAccount: (repoPath: string, accountId: string | null) => void;
  setRepoVisibility: (repoPath: string, visibility: RepoVisibility) => void;
  setOwnerType: (owner: string, type: "User" | "Organization") => void;
  setRepoPermission: (repoPath: string, permission: RepoPermission | null) => void;
  toggleGroupCollapsed: (label: string) => void;
  toggleFavorite: (path: string) => void;
  setAutoSync: (repoPath: string, setting: AutoSyncSetting) => void;
  setStatusEntries: (entries: StatusEntry[]) => void;
  setLoading: (loading: boolean) => void;
}

/**
 * 워크트리를 보는 중이어도 항상 소유 저장소 경로를 돌려준다.
 * 워크트리 목록은 어느 워크트리에서 조회해도 같은 결과라, 소유 저장소 경로 하나로
 * 캐시를 모으면 워크트리마다 목록을 중복 조회하지 않는다. 현재 워크트리가 끊겼을 때도
 * 메인 저장소에서는 목록을 읽을 수 있다.
 */
export function useOwnerRepoPath(): string | null {
  return useRepositoryStore((s) => s.activeRepo?.path ?? s.activeRepoPath);
}

/**
 * 저장소 목록에 표시할 상태를 어느 경로에서 읽을지 정한다.
 *
 * 워크트리를 보던 저장소는 메인이 아니라 그 워크트리의 상태를 보여줘야 한다.
 * 목록에서 클릭하면 그 워크트리로 들어가므로(activateRepo), 표시와 실제로 열리는
 * 곳이 어긋나지 않는다. 워크트리에 변경·미푸시 커밋이 쌓여도 메인 작업 트리는
 * 깨끗해서, 메인 경로로 계산하면 아무 표시도 나오지 않는다.
 */
export function repoViewPath(
  activeWorktrees: Record<string, string>,
  repoPath: string,
): string {
  return activeWorktrees[repoPath] ?? repoPath;
}

/** {@link repoViewPath} 를 현재 스토어 상태에 묶어 돌려준다. */
export function useRepoViewPath(): (repoPath: string) => string {
  const activeWorktrees = useRepositoryStore((s) => s.activeWorktrees);
  return useCallback(
    (path: string) => repoViewPath(activeWorktrees, path),
    [activeWorktrees],
  );
}

export const REPOS_STORAGE_KEY = "gitbaro-repos";
/**
 * v0: `version` 없이 저장하던 값(zustand 기본값 0).
 * v1: 워크스페이스 선택(W4-T1)과 함께 버전을 매기기 시작했다. 모양은 v0과 같고,
 *     `activeRepoPath`가 null이면 「워크스페이스를 고른 상태」일 수 있다는 뜻이 더해졌다.
 */
export const REPOS_STORAGE_VERSION = 1;

/** 저장하는 필드. `partialize`와 변환 함수가 같은 목록을 쓴다. */
export type RepositoryPersistedState = Pick<
  RepositoryState,
  | "repos"
  | "activeRepoPath"
  | "repoVisibility"
  | "ownerTypes"
  | "collapsedGroups"
  | "favoriteRepos"
  | "activeWorktrees"
  | "autoSyncByRepo"
>;

const isPlainRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

/**
 * 저장값을 v1로 옮긴다. 모양이 맞는 필드는 그대로 두고, 깨진 필드만 기본값으로 바꾼다.
 * v0과 v1은 모양이 같으므로 옮기면서 값이 사라지지 않는다. 모르는 필드는 버린다.
 */
export function migrateRepositoryState(
  persisted: unknown,
  _fromVersion: number,
): Partial<RepositoryPersistedState> {
  const src = isPlainRecord(persisted) ? persisted : {};
  const out: Partial<RepositoryPersistedState> = {};
  if (Array.isArray(src.repos)) out.repos = src.repos as RepoInfo[];
  if (typeof src.activeRepoPath === "string" || src.activeRepoPath === null) {
    out.activeRepoPath = src.activeRepoPath;
  }
  if (isPlainRecord(src.repoVisibility)) {
    out.repoVisibility = src.repoVisibility as Record<string, RepoVisibility>;
  }
  if (isPlainRecord(src.ownerTypes)) {
    out.ownerTypes = src.ownerTypes as Record<string, "User" | "Organization">;
  }
  if (isStrings(src.collapsedGroups)) out.collapsedGroups = src.collapsedGroups;
  if (isStrings(src.favoriteRepos)) out.favoriteRepos = src.favoriteRepos;
  if (isPlainRecord(src.activeWorktrees)) {
    out.activeWorktrees = Object.fromEntries(
      Object.entries(src.activeWorktrees).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  }
  if (isPlainRecord(src.autoSyncByRepo)) {
    out.autoSyncByRepo = src.autoSyncByRepo as Record<string, AutoSyncSetting>;
  }
  return out;
}

export const useRepositoryStore = create<RepositoryState>()(
  persist(
    (set, get) => ({
      repos: [],
      activeRepoPath: null,
      activeRepo: null,
      statusEntries: [],
      isLoading: false,
      repoVisibility: {},
      ownerTypes: {},
      repoPermissions: {},
      collapsedGroups: [],
      favoriteRepos: [],
      activeWorktrees: {},
      autoSyncByRepo: {},

      setActiveRepo: (path, parentRepoPath?) => {
        const ownerPath = parentRepoPath ?? path;
        const repo = get().repos.find((r) => r.path === ownerPath) ?? null;
        set({ activeRepoPath: path, activeRepo: repo });
      },

      // 기억은 전환이 성공한 뒤에만 남겨야 한다(useOpenWorktree). 전환과 한 몸으로
      // 묶으면 열지 못한 워크트리가 그대로 저장돼 다음 실행까지 따라온다.
      rememberWorktree: (repoPath, worktreePath) =>
        set((state) => {
          const current = state.activeWorktrees[repoPath] ?? null;
          if (current === worktreePath) return state;
          const { [repoPath]: _removed, ...rest } = state.activeWorktrees;
          return {
            activeWorktrees:
              worktreePath === null ? rest : { ...rest, [repoPath]: worktreePath },
          };
        }),

      activateRepo: (repoPath) => {
        const remembered = get().activeWorktrees[repoPath];
        get().setActiveRepo(remembered ?? repoPath, repoPath);
      },

      clearActiveRepo: () => {
        if (get().activeRepoPath === null && get().activeRepo === null) return;
        set({ activeRepoPath: null, activeRepo: null });
      },

      addRepo: (repo) =>
        set((state) => ({
          repos: state.repos.some((r) => r.path === repo.path)
            ? state.repos.map((r) => (r.path === repo.path ? repo : r))
            : [...state.repos, repo],
        })),

      removeRepo: (path) =>
        set((state) => {
          const repos = state.repos.filter((r) => r.path !== path);
          const { [path]: removedWorktree, ...activeWorktrees } = state.activeWorktrees;
          const { [path]: _removedAutoSync, ...autoSyncByRepo } = state.autoSyncByRepo;
          // 그 저장소의 워크트리를 보던 중이었다면 activeRepoPath가 사라진 저장소를
          // 가리키게 되므로 함께 비운다.
          const wasActive =
            state.activeRepoPath === path || state.activeRepoPath === removedWorktree;
          const activeRepoPath = wasActive ? null : state.activeRepoPath;
          return {
            repos,
            activeRepoPath,
            activeRepo: findOwnerRepo(repos, activeRepoPath, activeWorktrees),
            activeWorktrees,
            autoSyncByRepo,
          };
        }),

      setRepos: (repos) => {
        const { activeRepoPath } = get();
        const activeRepo = activeRepoPath
          ? repos.find((r) => r.path === activeRepoPath) ?? null
          : null;
        set({ repos, activeRepo });
      },

      updateRepoAccount: (repoPath, accountId) =>
        set((state) => {
          const repos = state.repos.map((r) =>
            r.path === repoPath ? { ...r, accountId } : r,
          );
          const activeRepo =
            state.activeRepoPath === repoPath
              ? repos.find((r) => r.path === repoPath) ?? null
              : state.activeRepo;
          return { repos, activeRepo };
        }),

      setRepoVisibility: (repoPath, visibility) =>
        set((state) => ({
          repoVisibility: { ...state.repoVisibility, [repoPath]: visibility },
        })),

      setOwnerType: (owner, ownerType) =>
        set((state) => ({
          ownerTypes: { ...state.ownerTypes, [owner]: ownerType },
        })),

      setRepoPermission: (repoPath, permission) =>
        set((state) => {
          if (permission === null) {
            const { [repoPath]: _, ...rest } = state.repoPermissions;
            return { repoPermissions: rest };
          }
          return { repoPermissions: { ...state.repoPermissions, [repoPath]: permission } };
        }),

      toggleGroupCollapsed: (label) =>
        set((state) => {
          const isCollapsed = state.collapsedGroups.includes(label);
          return {
            collapsedGroups: isCollapsed
              ? state.collapsedGroups.filter((g) => g !== label)
              : [...state.collapsedGroups, label],
          };
        }),

      toggleFavorite: (path) =>
        set((state) => {
          const isFav = state.favoriteRepos.includes(path);
          return {
            favoriteRepos: isFav
              ? state.favoriteRepos.filter((p) => p !== path)
              : [...state.favoriteRepos, path],
          };
        }),

      setAutoSync: (repoPath, setting) =>
        set((state) => ({
          autoSyncByRepo: { ...state.autoSyncByRepo, [repoPath]: setting },
        })),

      setStatusEntries: (entries) => set({ statusEntries: entries }),

      setLoading: (loading) => set({ isLoading: loading }),
    }),
    {
      name: REPOS_STORAGE_KEY,
      version: REPOS_STORAGE_VERSION,
      storage: createJSONStorage(() => createSafeStorage()),
      migrate: (persisted, version) =>
        migrateRepositoryState(persisted, version) as RepositoryState,
      partialize: (state): RepositoryPersistedState => ({
        repos: state.repos,
        activeRepoPath: state.activeRepoPath,
        repoVisibility: state.repoVisibility,
        ownerTypes: state.ownerTypes,
        collapsedGroups: state.collapsedGroups,
        favoriteRepos: state.favoriteRepos,
        activeWorktrees: state.activeWorktrees,
        autoSyncByRepo: state.autoSyncByRepo,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const { repos, activeRepoPath, activeWorktrees } = state;
        // 워크트리를 보던 채로 종료했다면 activeRepoPath는 repos에 없는 경로다.
        state.activeRepo = findOwnerRepo(repos, activeRepoPath, activeWorktrees);
      },
    },
  ),
);

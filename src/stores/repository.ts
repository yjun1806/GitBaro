import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { RepoInfo, StatusEntry } from "@/types";
import type { RepoVisibility } from "@/api/commands";

export interface RepoPermission {
  valid: boolean;
  canPush: boolean;
  reason?: string;
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
  setActiveRepo: (path: string, parentRepoPath?: string) => void;
  addRepo: (repo: RepoInfo) => void;
  removeRepo: (path: string) => void;
  setRepos: (repos: RepoInfo[]) => void;
  updateRepoAccount: (repoPath: string, accountId: string | null) => void;
  setRepoVisibility: (repoPath: string, visibility: RepoVisibility) => void;
  setOwnerType: (owner: string, type: "User" | "Organization") => void;
  setRepoPermission: (repoPath: string, permission: RepoPermission | null) => void;
  toggleGroupCollapsed: (label: string) => void;
  toggleFavorite: (path: string) => void;
  setStatusEntries: (entries: StatusEntry[]) => void;
  setLoading: (loading: boolean) => void;
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

      setActiveRepo: (path, parentRepoPath?) => {
        const lookupPath = parentRepoPath ?? path;
        const repo = get().repos.find((r) => r.path === lookupPath) ?? null;
        set({ activeRepoPath: path, activeRepo: repo });
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
          const activeRepoPath = state.activeRepoPath === path ? null : state.activeRepoPath;
          const activeRepo = activeRepoPath
            ? repos.find((r) => r.path === activeRepoPath) ?? null
            : null;
          return { repos, activeRepoPath, activeRepo };
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

      setStatusEntries: (entries) => set({ statusEntries: entries }),

      setLoading: (loading) => set({ isLoading: loading }),
    }),
    {
      name: "gitbaro-repos",
      partialize: (state) => ({
        repos: state.repos,
        activeRepoPath: state.activeRepoPath,
        repoVisibility: state.repoVisibility,
        ownerTypes: state.ownerTypes,
        collapsedGroups: state.collapsedGroups,
        favoriteRepos: state.favoriteRepos,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const { repos, activeRepoPath } = state;
        if (activeRepoPath) {
          const activeRepo = repos.find((r) => r.path === activeRepoPath) ?? null;
          state.activeRepo = activeRepo;
        }
      },
    },
  ),
);

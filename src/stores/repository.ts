import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { RepoInfo, StatusEntry } from "@/types";

interface RepositoryState {
  repos: RepoInfo[];
  activeRepoPath: string | null;
  activeRepo: RepoInfo | null;
  statusEntries: StatusEntry[];
  isLoading: boolean;
  setActiveRepo: (path: string) => void;
  addRepo: (repo: RepoInfo) => void;
  removeRepo: (path: string) => void;
  setRepos: (repos: RepoInfo[]) => void;
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

      setActiveRepo: (path) => {
        const repo = get().repos.find((r) => r.path === path) ?? null;
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

      setStatusEntries: (entries) => set({ statusEntries: entries }),

      setLoading: (loading) => set({ isLoading: loading }),
    }),
    {
      name: "gitease-repos",
      partialize: (state) => ({
        repos: state.repos,
        activeRepoPath: state.activeRepoPath,
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

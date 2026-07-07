import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Theme } from "@/types";

/** Repo rail display mode (Supabase-style sidebar control) */
export type RailMode = "expanded" | "collapsed" | "hover";

interface UIState {
  theme: Theme;
  activeTab: "changes" | "history" | "stash" | "actions";
  sidebarWidth: number;
  isSidebarCollapsed: boolean;
  railMode: RailMode;
  repoListOpen: boolean;
  compareBranch: string | null;
  previewBranch: string | null;
  isActivityLogOpen: boolean;
  setTheme: (theme: Theme) => void;
  setActiveTab: (tab: "changes" | "history" | "stash" | "actions") => void;
  setSidebarWidth: (width: number) => void;
  toggleSidebar: () => void;
  setRailMode: (mode: RailMode) => void;
  setRepoListOpen: (open: boolean) => void;
  setCompareBranch: (branch: string | null) => void;
  setPreviewBranch: (branch: string | null) => void;
  setActivityLogOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      theme: "system",
      activeTab: "changes",
      sidebarWidth: 500,
      isSidebarCollapsed: false,
      railMode: "hover",
      repoListOpen: false,
      compareBranch: null,
      previewBranch: null,
      isActivityLogOpen: false,

      setTheme: (theme) => set({ theme }),

      setActiveTab: (tab) => set({ activeTab: tab }),

      setSidebarWidth: (width) => set({ sidebarWidth: width }),

      toggleSidebar: () =>
        set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),

      setRailMode: (mode) => set({ railMode: mode }),

      setRepoListOpen: (open) => set({ repoListOpen: open }),

      setCompareBranch: (branch) => set({ compareBranch: branch }),
      setPreviewBranch: (branch) => set({ previewBranch: branch }),
      setActivityLogOpen: (open) => set({ isActivityLogOpen: open }),
    }),
    {
      name: "gitbaro-ui",
      // Only the rail mode is persisted; all other UI state stays ephemeral.
      partialize: (state) => ({ railMode: state.railMode }),
    },
  ),
);

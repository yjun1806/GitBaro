import { create } from "zustand";
import type { Theme } from "@/types";

interface UIState {
  theme: Theme;
  activeTab: "changes" | "history" | "stash";
  sidebarWidth: number;
  isSidebarCollapsed: boolean;
  repoListOpen: boolean;
  compareBranch: string | null;
  previewBranch: string | null;
  isActivityLogOpen: boolean;
  setTheme: (theme: Theme) => void;
  setActiveTab: (tab: "changes" | "history" | "stash") => void;
  setSidebarWidth: (width: number) => void;
  toggleSidebar: () => void;
  setRepoListOpen: (open: boolean) => void;
  setCompareBranch: (branch: string | null) => void;
  setPreviewBranch: (branch: string | null) => void;
  setActivityLogOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  theme: "system",
  activeTab: "changes",
  sidebarWidth: 500,
  isSidebarCollapsed: false,
  repoListOpen: false,
  compareBranch: null,
  previewBranch: null,
  isActivityLogOpen: false,

  setTheme: (theme) => set({ theme }),

  setActiveTab: (tab) => set({ activeTab: tab }),

  setSidebarWidth: (width) => set({ sidebarWidth: width }),

  toggleSidebar: () =>
    set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),

  setRepoListOpen: (open) => set({ repoListOpen: open }),

  setCompareBranch: (branch) => set({ compareBranch: branch }),
  setPreviewBranch: (branch) => set({ previewBranch: branch }),
  setActivityLogOpen: (open) => set({ isActivityLogOpen: open }),
}));

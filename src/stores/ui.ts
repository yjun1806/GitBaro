import { create } from "zustand";
import type { Theme } from "@/types";

interface UIState {
  theme: Theme;
  activeTab: "changes" | "history";
  sidebarWidth: number;
  isSidebarCollapsed: boolean;
  repoListOpen: boolean;
  compareBranch: string | null;
  setTheme: (theme: Theme) => void;
  setActiveTab: (tab: "changes" | "history") => void;
  setSidebarWidth: (width: number) => void;
  toggleSidebar: () => void;
  setRepoListOpen: (open: boolean) => void;
  setCompareBranch: (branch: string | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  theme: "system",
  activeTab: "changes",
  sidebarWidth: 500,
  isSidebarCollapsed: false,
  repoListOpen: false,
  compareBranch: null,

  setTheme: (theme) => set({ theme }),

  setActiveTab: (tab) => set({ activeTab: tab }),

  setSidebarWidth: (width) => set({ sidebarWidth: width }),

  toggleSidebar: () =>
    set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),

  setRepoListOpen: (open) => set({ repoListOpen: open }),

  setCompareBranch: (branch) => set({ compareBranch: branch }),
}));

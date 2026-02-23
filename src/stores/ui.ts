import { create } from "zustand";
import type { Theme } from "@/types";

interface UIState {
  theme: Theme;
  activeTab: "changes" | "history";
  sidebarWidth: number;
  isSidebarCollapsed: boolean;
  setTheme: (theme: Theme) => void;
  setActiveTab: (tab: "changes" | "history") => void;
  setSidebarWidth: (width: number) => void;
  toggleSidebar: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  theme: "system",
  activeTab: "changes",
  sidebarWidth: 500,
  isSidebarCollapsed: false,

  setTheme: (theme) => set({ theme }),

  setActiveTab: (tab) => set({ activeTab: tab }),

  setSidebarWidth: (width) => set({ sidebarWidth: width }),

  toggleSidebar: () =>
    set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),
}));

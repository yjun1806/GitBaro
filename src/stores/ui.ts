import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Theme } from "@/types";

/** Repo rail display mode (Supabase-style sidebar control) */
export type RailMode = "expanded" | "collapsed" | "hover";

/** Sidebar tabs. A session is a way of *viewing* history, not a fifth place. */
export type ActiveTab = "changes" | "history" | "stash" | "actions";

const RAIL_MODES: readonly RailMode[] = ["expanded", "collapsed", "hover"];
const ACTIVE_TABS: readonly ActiveTab[] = ["changes", "history", "stash", "actions"];

function isRailMode(value: unknown): value is RailMode {
  return RAIL_MODES.includes(value as RailMode);
}

function isActiveTab(value: unknown): value is ActiveTab {
  return ACTIVE_TABS.includes(value as ActiveTab);
}

/**
 * Resolves a rehydrated tab, falling back when it is not one this build knows.
 * `"sessions"` used to be a tab and is now a History view mode, so a store
 * written by an older build lands on History instead of selecting a branch
 * that renders nothing.
 */
function resolveActiveTab(value: unknown, fallback: ActiveTab): ActiveTab {
  if (value === "sessions") return "history";
  return isActiveTab(value) ? value : fallback;
}

interface UIState {
  theme: Theme;
  activeTab: ActiveTab;
  sidebarWidth: number;
  isSidebarCollapsed: boolean;
  railMode: RailMode;
  repoListOpen: boolean;
  compareBranch: string | null;
  previewBranch: string | null;
  isActivityLogOpen: boolean;
  /** 브랜치 전환(checkout + 재조회) 진행 중 여부. 로딩 피드백 표시에 사용. */
  isSwitchingBranch: boolean;
  setTheme: (theme: Theme) => void;
  setActiveTab: (tab: ActiveTab) => void;
  setSidebarWidth: (width: number) => void;
  toggleSidebar: () => void;
  setRailMode: (mode: RailMode) => void;
  setRepoListOpen: (open: boolean) => void;
  setCompareBranch: (branch: string | null) => void;
  setPreviewBranch: (branch: string | null) => void;
  setActivityLogOpen: (open: boolean) => void;
  setSwitchingBranch: (switching: boolean) => void;
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
      isSwitchingBranch: false,

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
      setSwitchingBranch: (switching) => set({ isSwitchingBranch: switching }),
    }),
    {
      name: "gitbaro-ui",
      // Rail mode is the one choice worth keeping between launches; the rest of
      // the UI state stays ephemeral.
      partialize: (state) => ({
        railMode: state.railMode,
      }),
      // Rehydration is not trusted: the stored blob may come from a build with
      // a different set of tabs, so every value is re-validated on the way in.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Record<string, unknown>;
        return {
          ...current,
          railMode: isRailMode(saved.railMode) ? saved.railMode : current.railMode,
          activeTab: resolveActiveTab(saved.activeTab, current.activeTab),
        };
      },
    },
  ),
);

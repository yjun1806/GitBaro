import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createSafeStorage } from "@/lib/safe-storage";
import type { Theme } from "@/types";

/** Repo rail display mode (Supabase-style sidebar control) */
export type RailMode = "expanded" | "collapsed" | "hover";

/** Line-diff layout the user last picked; remembered across files and restarts. */
export type DiffLineMode = "unified" | "split";

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
  /** 브랜치 전환(checkout + 재조회) 진행 중 여부. 로딩 피드백 표시에 사용. */
  isSwitchingBranch: boolean;
  diffLineMode: DiffLineMode;
  setTheme: (theme: Theme) => void;
  setActiveTab: (tab: "changes" | "history" | "stash" | "actions") => void;
  setSidebarWidth: (width: number) => void;
  toggleSidebar: () => void;
  setRailMode: (mode: RailMode) => void;
  setRepoListOpen: (open: boolean) => void;
  setCompareBranch: (branch: string | null) => void;
  setPreviewBranch: (branch: string | null) => void;
  setActivityLogOpen: (open: boolean) => void;
  setSwitchingBranch: (switching: boolean) => void;
  setDiffLineMode: (mode: DiffLineMode) => void;
}

// Matches MainLayout's drag minimum.
const MIN_PERSISTED_SIDEBAR_WIDTH = 200;
const RAIL_MODES: readonly RailMode[] = ["expanded", "collapsed", "hover"];
const DIFF_LINE_MODES: readonly DiffLineMode[] = ["unified", "split"];

/**
 * Picks only well-formed persisted fields. localStorage can hold values from an
 * older build or a hand edit; a bad width would collapse the layout.
 */
export function sanitizePersistedUI(persisted: unknown): Partial<UIState> {
  if (typeof persisted !== "object" || persisted === null) return {};
  const p = persisted as Record<string, unknown>;
  const out: Partial<UIState> = {};
  if (RAIL_MODES.includes(p.railMode as RailMode)) out.railMode = p.railMode as RailMode;
  if (typeof p.sidebarWidth === "number" && Number.isFinite(p.sidebarWidth) && p.sidebarWidth >= MIN_PERSISTED_SIDEBAR_WIDTH) {
    out.sidebarWidth = p.sidebarWidth;
  }
  if (DIFF_LINE_MODES.includes(p.diffLineMode as DiffLineMode)) {
    out.diffLineMode = p.diffLineMode as DiffLineMode;
  }
  return out;
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
      diffLineMode: "unified",

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
      setDiffLineMode: (mode) => set({ diffLineMode: mode }),
    }),
    {
      name: "gitbaro-ui",
      storage: createJSONStorage(() => createSafeStorage()),
      // Layout preferences are persisted here. The theme is not: its source of
      // truth is the backend settings file, applied at startup (App.tsx).
      partialize: (state) => ({
        railMode: state.railMode,
        sidebarWidth: state.sidebarWidth,
        diffLineMode: state.diffLineMode,
      }),
      merge: (persisted, current) => ({ ...current, ...sanitizePersistedUI(persisted) }),
    },
  ),
);

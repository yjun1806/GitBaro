import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createSafeStorage } from "@/lib/safe-storage";
import { MIN_SIDEBAR_WIDTH } from "@/lib/sidebar-width";
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

/** Sidebar width in the two-column shell's design (`gen_d.py` sidebar, 276px). */
export const DEFAULT_SIDEBAR_WIDTH = 276;

const RAIL_MODES: readonly RailMode[] = ["expanded", "collapsed", "hover"];
const DIFF_LINE_MODES: readonly DiffLineMode[] = ["unified", "split"];

/** Fields of the UI store written to `gitbaro-ui` (see `partialize`). */
type PersistedUI = Pick<UIState, "railMode" | "sidebarWidth" | "diffLineMode">;

/** Storage version of `gitbaro-ui`. v1: `sidebarWidth` became the tree sidebar's width (W2-T1). */
export const UI_STORE_VERSION = 1;

/**
 * Moves stored UI state to the current version. Up to v0, `sidebarWidth` was
 * the width of the old Changes/History tab column (default 500). Persist writes
 * the whole state on every change, so almost every v0 user has that value
 * stored even if they never resized anything. In v1 the same key sizes the
 * tree sidebar (design 276px), so the old value is dropped and the new default
 * applies. Other fields keep their meaning and pass through.
 */
export function migrateUI(persisted: unknown, version: number): unknown {
  if (typeof persisted !== "object" || persisted === null) return persisted;
  if (version < 1) {
    const next: Record<string, unknown> = { ...(persisted as Record<string, unknown>) };
    delete next.sidebarWidth;
    return next;
  }
  return persisted;
}

/**
 * Picks only well-formed persisted fields. localStorage can hold values from an
 * older build or a hand edit; a bad width would collapse the layout. The upper
 * bound depends on the window, so MainLayout applies it with clampSidebarWidth.
 */
export function sanitizePersistedUI(persisted: unknown): Partial<UIState> {
  if (typeof persisted !== "object" || persisted === null) return {};
  const p = persisted as Record<string, unknown>;
  const out: Partial<UIState> = {};
  if (RAIL_MODES.includes(p.railMode as RailMode)) out.railMode = p.railMode as RailMode;
  if (typeof p.sidebarWidth === "number" && Number.isFinite(p.sidebarWidth) && p.sidebarWidth >= MIN_SIDEBAR_WIDTH) {
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
      // W2-T1: 두 칸 셸에서 이 폭은 트리 사이드바 폭이다(시안 276px). 저장된 값이 있으면 그 값을 쓴다.
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      isSidebarCollapsed: false,
      // 시안은 트리 사이드바가 늘 보이는 두 칸이다(gen_d.py sidebar 276px). 새로 설치하면
      // 고정으로 펼친 모드로 시작한다. 이미 저장된 모드는 사용자 선택이라 그대로 둔다.
      railMode: "expanded",
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
      version: UI_STORE_VERSION,
      // merge() below re-checks every field, so the shape is only asserted here.
      migrate: (persisted, version) => migrateUI(persisted, version) as PersistedUI,
      storage: createJSONStorage(() => createSafeStorage()),
      // Layout preferences are persisted here. The theme is not: its source of
      // truth is the backend settings file, applied at startup (App.tsx).
      // activeTab is not persisted either, so the two-column shell (W2-T1) could
      // regroup the tabs without migrating it: the graph panel's "commit graph"
      // tab covers "changes" (uncommitted row) and "history".
      partialize: (state) => ({
        railMode: state.railMode,
        sidebarWidth: state.sidebarWidth,
        diffLineMode: state.diffLineMode,
      }),
      merge: (persisted, current) => ({ ...current, ...sanitizePersistedUI(persisted) }),
    },
  ),
);

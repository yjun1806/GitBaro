import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createSafeStorage } from "@/lib/safe-storage";
import { MIN_SIDEBAR_WIDTH } from "@/lib/sidebar-width";
import {
  clampFileListWidth,
  clampGraphRatio,
  DEFAULT_FILE_LIST_WIDTH,
  DEFAULT_GRAPH_RATIO,
} from "@/lib/split-size";
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
  /** 그래프 패널이 메인 칸 높이에서 차지하는 비율(손잡이로 조절, 저장). */
  graphPanelRatio: number;
  /** 파일 목록 ↔ diff 사이의 목록 폭(px, 손잡이로 조절, 저장). */
  fileListWidth: number;
  /** diff를 메인 칸 전체로 키웠는가. 저장하지 않는다. */
  isDiffMaximized: boolean;
  /**
   * 「커밋하기」를 누른 시각(epoch ms). 커밋 입력(`ChangesView`)이 마운트되거나 이 값이 바뀌면
   * 요약 칸에 포커스를 옮기고 지운다. 저장하지 않는다.
   */
  commitFocusAt: number | null;
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
  setGraphPanelRatio: (ratio: number) => void;
  setFileListWidth: (width: number) => void;
  setDiffMaximized: (maximized: boolean) => void;
  setCommitFocusAt: (at: number | null) => void;
}

/** Sidebar width in the two-column shell's design (`gen_d.py` sidebar, 276px). */
export const DEFAULT_SIDEBAR_WIDTH = 276;

const RAIL_MODES: readonly RailMode[] = ["expanded", "collapsed", "hover"];
const DIFF_LINE_MODES: readonly DiffLineMode[] = ["unified", "split"];

/** Fields of the UI store written to `gitbaro-ui` (see `partialize`). */
type PersistedUI = Pick<
  UIState,
  "railMode" | "sidebarWidth" | "diffLineMode" | "graphPanelRatio" | "fileListWidth"
>;

/**
 * Storage version of `gitbaro-ui`. `activeTab` is not persisted (see
 * `partialize` below), so the two-column shell's tab regrouping (W2-T1)
 * never needed a migration, and the task's own rule is to leave the version
 * unbumped when the persisted values keep their meaning ("값이 그대로면
 * 버전을 올리지 않습니다"). `sidebarWidth` now sizes the tree sidebar
 * instead of the old tab column, but a stale width only changes how wide the
 * sidebar opens, and `sanitizePersistedUI` already discards anything below
 * `MIN_SIDEBAR_WIDTH` while `MainLayout` clamps the upper bound. `railMode`
 * must survive as-is: W2-T2 requires keeping the rail's collapsed/hover
 * modes, so a v0 user's deliberate choice is never silently reset to
 * "expanded".
 * `graphPanelRatio`·`fileListWidth`는 나중에 더한 선택 필드다. 없으면 기본값을 쓰므로
 * (`sanitizePersistedUI`) 버전을 올리지 않는다.
 */
export const UI_STORE_VERSION = 0;

/** Identity migration: no persisted `gitbaro-ui` field has changed meaning enough to require one. */
export function migrateUI(persisted: unknown, _version: number): unknown {
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
  // 범위를 벗어난 숫자는 버리지 않고 범위 안으로 맞춘다(사용자가 끌어 둔 방향은 살린다).
  if (typeof p.graphPanelRatio === "number" && Number.isFinite(p.graphPanelRatio)) {
    out.graphPanelRatio = clampGraphRatio(p.graphPanelRatio);
  }
  if (typeof p.fileListWidth === "number" && Number.isFinite(p.fileListWidth)) {
    out.fileListWidth = clampFileListWidth(p.fileListWidth);
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
      // 시안은 트리 사이드바가 늘 보이는 두 칸이다(gen_d.py sidebar 276px). 새로 설치할
      // 때만 이 기본값을 쓴다. 저장된 값(옛 rail-only 셸에서 고른 hover/collapsed 포함)이
      // 있으면 merge()에서 그 값을 그대로 되살린다(W2-T2: rail의 접힘·hover 모드 유지).
      railMode: "expanded",
      repoListOpen: false,
      compareBranch: null,
      previewBranch: null,
      isActivityLogOpen: false,
      isSwitchingBranch: false,
      diffLineMode: "unified",
      graphPanelRatio: DEFAULT_GRAPH_RATIO,
      fileListWidth: DEFAULT_FILE_LIST_WIDTH,
      isDiffMaximized: false,
      commitFocusAt: null,

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
      setGraphPanelRatio: (ratio) => set({ graphPanelRatio: clampGraphRatio(ratio) }),
      setFileListWidth: (width) => set({ fileListWidth: clampFileListWidth(width) }),
      setDiffMaximized: (maximized) => set({ isDiffMaximized: maximized }),
      setCommitFocusAt: (at) => set({ commitFocusAt: at }),
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
        graphPanelRatio: state.graphPanelRatio,
        fileListWidth: state.fileListWidth,
      }),
      merge: (persisted, current) => ({ ...current, ...sanitizePersistedUI(persisted) }),
    },
  ),
);

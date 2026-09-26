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

/** Line-diff layout the user last picked; remembered across files and restarts. */
export type DiffLineMode = "unified" | "split";

/** 워크스페이스 리뷰 화면의 그래프 카드가 보여 줄 것: 커밋 순서(그래프) 또는 파일별. */
export type ReviewFileView = "commits" | "files";

const REVIEW_FILE_VIEWS: readonly ReviewFileView[] = ["commits", "files"];

interface UIState {
  theme: Theme;
  activeTab: "changes" | "history" | "stash" | "actions";
  sidebarWidth: number;
  /** 사이드바를 통째로 숨겼는가(⌘\, 사이드바 버튼, 저장). 숨기지 않으면 늘 펼친 트리다. */
  sidebarHidden: boolean;
  repoListOpen: boolean;
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
  /** 크게 보는 diff 왼쪽에 좁은 파일 목록을 둘지(diff 머리의 버튼, 저장). */
  maximizedFileListOpen: boolean;
  /**
   * 「작업 중인 변경」을 연 시각(epoch ms). 스테이징 목록(`ChangesView`)이 마운트되거나 이 값이 바뀌면
   * 파일 목록에 포커스를 옮기고 지운다. 저장하지 않는다.
   */
  workingFocusAt: number | null;
  /** 워크스페이스마다 마지막으로 고른 리뷰 보기(커밋 순서·파일별, 워크스페이스 id로 키). */
  reviewFileViewByWorkspace: Readonly<Record<string, ReviewFileView>>;
  /** 커밋·스태시 상세의 정보 칸(제목 아래 요약/펼침)을 펼쳐 뒀는지. 기본은 접힘(저장). */
  commitInfoExpanded: boolean;
  setTheme: (theme: Theme) => void;
  setActiveTab: (tab: "changes" | "history" | "stash" | "actions") => void;
  setSidebarWidth: (width: number) => void;
  setSidebarHidden: (hidden: boolean) => void;
  toggleSidebar: () => void;
  setRepoListOpen: (open: boolean) => void;
  setActivityLogOpen: (open: boolean) => void;
  setSwitchingBranch: (switching: boolean) => void;
  setDiffLineMode: (mode: DiffLineMode) => void;
  setGraphPanelRatio: (ratio: number) => void;
  setFileListWidth: (width: number) => void;
  setDiffMaximized: (maximized: boolean) => void;
  setMaximizedFileListOpen: (open: boolean) => void;
  setWorkingFocusAt: (at: number | null) => void;
  setReviewFileView: (workspaceId: string, view: ReviewFileView) => void;
  setCommitInfoExpanded: (expanded: boolean) => void;
}

/** Sidebar width in the two-column shell's design (`gen_d.py` sidebar, 276px). */
export const DEFAULT_SIDEBAR_WIDTH = 276;

const DIFF_LINE_MODES: readonly DiffLineMode[] = ["unified", "split"];

/** Fields of the UI store written to `gitbaro-ui` (see `partialize`). */
type PersistedUI = Pick<
  UIState,
  | "sidebarHidden"
  | "sidebarWidth"
  | "diffLineMode"
  | "graphPanelRatio"
  | "fileListWidth"
  | "maximizedFileListOpen"
  | "reviewFileViewByWorkspace"
  | "commitInfoExpanded"
>;

/**
 * Storage version of `gitbaro-ui`. `activeTab` is not persisted (see
 * `partialize` below), so the two-column shell's tab regrouping (W2-T1)
 * never needed a migration, and the task's own rule is to leave the version
 * unbumped when the persisted values keep their meaning ("값이 그대로면
 * 버전을 올리지 않습니다"). `sidebarWidth` now sizes the tree sidebar
 * instead of the old tab column, but a stale width only changes how wide the
 * sidebar opens, and `sanitizePersistedUI` already discards anything below
 * `MIN_SIDEBAR_WIDTH` while `MainLayout` clamps the upper bound.
 * 없앤 `railMode`(펼침·접힘·hover)도 버전을 올리지 않는다. 그 자리를 `sidebarHidden`이 잇는데,
 * 옛 값은 무엇이었든(접힘·hover 포함) 숨기지 않은 펼침으로 본다. 업그레이드한 사용자가 트리를 바로
 * 보게 하려는 것이다. `sanitizePersistedUI`는 `railMode`를 읽지 않으므로 `sidebarHidden`이 없는
 * 옛 저장값은 기본값(false)을 쓰고, 다음 저장 때 `partialize`가 `railMode`를 빼서 사라진다.
 * 다른 필드(`sidebarWidth` 등)는 그대로 살린다.
 * `graphPanelRatio`·`fileListWidth`·`maximizedFileListOpen`은 나중에 더한 선택 필드다. 없으면 기본값을 쓰므로
 * (`sanitizePersistedUI`) 버전을 올리지 않는다. 다른 필드의 뜻은 그대로라 옛 값을 지우지 않는다.
 * 없앤 `reviewBasis`(검토 기준 설정)도 버전을 올리지 않는다. 옛 저장값에 남은 그 필드는
 * `sanitizePersistedUI`가 읽지 않고, 다음 저장 때 `partialize`가 빼서 사라진다.
 * `reviewFileViewByWorkspace`(워크스페이스 리뷰의 커밋 순서·파일별 선택)도 나중에 더한 선택 필드라 버전을
 * 올리지 않는다. 없으면 빈 객체이므로 모든 워크스페이스가 기본값(`commits`)으로 시작한다.
 * `commitInfoExpanded`(커밋 상세의 정보 칸 펼침 여부)도 나중에 더한 선택 필드다. 없으면 기본값(접힘)을 쓴다.
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
  if (typeof p.sidebarHidden === "boolean") out.sidebarHidden = p.sidebarHidden;
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
  if (typeof p.maximizedFileListOpen === "boolean") out.maximizedFileListOpen = p.maximizedFileListOpen;
  if (typeof p.reviewFileViewByWorkspace === "object" && p.reviewFileViewByWorkspace !== null) {
    const src = p.reviewFileViewByWorkspace as Record<string, unknown>;
    const byWorkspace: Record<string, ReviewFileView> = {};
    for (const [workspaceId, view] of Object.entries(src)) {
      if (REVIEW_FILE_VIEWS.includes(view as ReviewFileView)) byWorkspace[workspaceId] = view as ReviewFileView;
    }
    out.reviewFileViewByWorkspace = byWorkspace;
  }
  if (typeof p.commitInfoExpanded === "boolean") out.commitInfoExpanded = p.commitInfoExpanded;
  return out;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      theme: "system",
      activeTab: "changes",
      // W2-T1: 두 칸 셸에서 이 폭은 트리 사이드바 폭이다(시안 276px). 저장된 값이 있으면 그 값을 쓴다.
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      // 시안은 트리 사이드바가 늘 보이는 두 칸이다(gen_d.py sidebar 276px).
      sidebarHidden: false,
      repoListOpen: false,
      isActivityLogOpen: false,
      isSwitchingBranch: false,
      diffLineMode: "unified",
      graphPanelRatio: DEFAULT_GRAPH_RATIO,
      fileListWidth: DEFAULT_FILE_LIST_WIDTH,
      isDiffMaximized: false,
      maximizedFileListOpen: true,
      workingFocusAt: null,
      reviewFileViewByWorkspace: {},
      commitInfoExpanded: false,

      setTheme: (theme) => set({ theme }),

      setActiveTab: (tab) => set({ activeTab: tab }),

      setSidebarWidth: (width) => set({ sidebarWidth: width }),

      setSidebarHidden: (hidden) => set({ sidebarHidden: hidden }),

      toggleSidebar: () => set((state) => ({ sidebarHidden: !state.sidebarHidden })),

      setRepoListOpen: (open) => set({ repoListOpen: open }),

      setActivityLogOpen: (open) => set({ isActivityLogOpen: open }),
      setSwitchingBranch: (switching) => set({ isSwitchingBranch: switching }),
      setDiffLineMode: (mode) => set({ diffLineMode: mode }),
      setGraphPanelRatio: (ratio) => set({ graphPanelRatio: clampGraphRatio(ratio) }),
      setFileListWidth: (width) => set({ fileListWidth: clampFileListWidth(width) }),
      setDiffMaximized: (maximized) => set({ isDiffMaximized: maximized }),
      setMaximizedFileListOpen: (open) => set({ maximizedFileListOpen: open }),
      setWorkingFocusAt: (at) => set({ workingFocusAt: at }),
      setReviewFileView: (workspaceId, view) =>
        set((state) => ({
          reviewFileViewByWorkspace: { ...state.reviewFileViewByWorkspace, [workspaceId]: view },
        })),
      setCommitInfoExpanded: (expanded) => set({ commitInfoExpanded: expanded }),
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
        sidebarHidden: state.sidebarHidden,
        sidebarWidth: state.sidebarWidth,
        diffLineMode: state.diffLineMode,
        graphPanelRatio: state.graphPanelRatio,
        fileListWidth: state.fileListWidth,
        maximizedFileListOpen: state.maximizedFileListOpen,
        reviewFileViewByWorkspace: state.reviewFileViewByWorkspace,
        commitInfoExpanded: state.commitInfoExpanded,
      }),
      merge: (persisted, current) => ({ ...current, ...sanitizePersistedUI(persisted) }),
    },
  ),
);

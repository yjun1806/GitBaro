import { create } from "zustand";
import type { PrStateFilter } from "@/types";

interface PrViewState {
  /**
   * 저장소 화면에서 「PR」 탭이 열려 있는가. 그래프 패널(탭 머리·목록)과 메인 칸(아래 상세)이 함께 본다.
   * 「파일별 변경」 탭처럼 저장하지 않는 화면 상태다(저장된 탭 `ui.activeTab`과 따로 둔다).
   */
  open: boolean;
  filter: PrStateFilter;
  /** 고른 PR. 고른 저장소(워크트리) 경로와 함께 둔다 — 다른 저장소에서는 고른 것이 없다. */
  selected: { repoPath: string; number: number } | null;
  /** 상세의 파일 칸에서 고른 파일. PR을 바꾸면 비운다. */
  selectedFile: string | null;
  setOpen: (open: boolean) => void;
  setFilter: (filter: PrStateFilter) => void;
  select: (repoPath: string, number: number) => void;
  selectFile: (path: string | null) => void;
}

export const usePrViewStore = create<PrViewState>()((set, get) => ({
  open: false,
  filter: "open",
  selected: null,
  selectedFile: null,
  setOpen: (open) => set({ open }),
  setFilter: (filter) => set({ filter }),
  select: (repoPath, number) => {
    const prev = get().selected;
    if (prev?.repoPath === repoPath && prev.number === number) return;
    set({ selected: { repoPath, number }, selectedFile: null });
  },
  selectFile: (selectedFile) => set({ selectedFile }),
}));

/** `repoPath`에서 고른 PR 번호. */
export function selectedPrNumber(
  state: Pick<PrViewState, "selected">,
  repoPath: string | null,
): number | null {
  return repoPath !== null && state.selected?.repoPath === repoPath ? state.selected.number : null;
}

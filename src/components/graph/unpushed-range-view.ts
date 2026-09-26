import { create } from "zustand";

/** 「올릴 내용 합쳐 보기」가 여는 범위: 아직 push하지 않은 커밋들. */
export interface UnpushedRange {
  repoPath: string;
  /** 범위의 시작(제외) — origin에 있는 첫 커밋. 처음부터면 null. */
  baseOid: string | null;
  /** 범위의 끝 — 열린 워크트리의 HEAD. */
  headOid: string;
}

interface UnpushedRangeViewState {
  /**
   * 저장소 화면에서 「올리지 않은 작업 · 원격에 올릴 내용」 칸이 열려 있는가. PR 탭(`pr-view.ts`)과
   * 같이 저장하지 않는 화면 상태다.
   */
  range: UnpushedRange | null;
  /** 상세 칸에서 고른 파일. 범위를 바꾸면 비운다. */
  selectedFile: string | null;
  open: (range: UnpushedRange) => void;
  close: () => void;
  selectFile: (path: string | null) => void;
}

export const useUnpushedRangeViewStore = create<UnpushedRangeViewState>()((set) => ({
  range: null,
  selectedFile: null,
  open: (range) => set({ range, selectedFile: null }),
  close: () => set({ range: null, selectedFile: null }),
  selectFile: (selectedFile) => set({ selectedFile }),
}));

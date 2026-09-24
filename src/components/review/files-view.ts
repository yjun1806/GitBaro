import { create } from "zustand";

/** 「파일별 변경」 목록을 무엇으로 나눌지. 저장소 그룹은 늘 있고, `folder`면 그 안을 폴더로 한 번 더 나눈다. */
export type FilesGroupBy = "repo" | "folder";

interface FilesViewState {
  /**
   * 저장소 화면에서 「파일별 변경」 탭이 열려 있는가. 그래프 패널(탭 머리)과 메인 칸(아래 목록·diff)이
   * 함께 본다. 저장하지 않는 화면 상태다(저장된 탭 `ui.activeTab`과 따로 둔다).
   */
  repoTabOpen: boolean;
  groupBy: FilesGroupBy;
  setRepoTabOpen: (open: boolean) => void;
  setGroupBy: (groupBy: FilesGroupBy) => void;
}

export const useFilesViewStore = create<FilesViewState>()((set) => ({
  repoTabOpen: false,
  groupBy: "repo",
  setRepoTabOpen: (repoTabOpen) => set({ repoTabOpen }),
  setGroupBy: (groupBy) => set({ groupBy }),
}));

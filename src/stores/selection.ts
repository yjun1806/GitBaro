import { create } from "zustand";
import { useRepositoryStore } from "./repository";

interface SelectionState {
  // Changes tab
  selectedFile: string | null;
  selectedFileStaged: boolean;
  // History tab
  selectedCommitId: string | null;
  // Stash tab
  selectedStashIndex: number | null;
  // Actions tab
  selectedRunId: number | null;
  // Sessions tab
  selectedSessionPath: string | null;

  // Actions
  selectFile: (path: string, staged: boolean) => void;
  selectCommit: (id: string) => void;
  selectStash: (index: number | null) => void;
  selectRun: (id: number) => void;
  selectSession: (sessionPath: string) => void;
  clearRunSelection: () => void;
  clearFileSelection: () => void;
  clearCommitSelection: () => void;
  clearStashSelection: () => void;
  clearAll: () => void;
}

export const useSelectionStore = create<SelectionState>()((set) => ({
  selectedFile: null,
  selectedFileStaged: false,
  selectedCommitId: null,
  selectedStashIndex: null,
  selectedRunId: null,
  selectedSessionPath: null,

  selectFile: (path, staged) =>
    set({ selectedFile: path, selectedFileStaged: staged }),

  selectCommit: (id) =>
    set({ selectedCommitId: id }),

  selectStash: (index) =>
    set({ selectedStashIndex: index }),

  selectRun: (id) =>
    set({ selectedRunId: id }),

  selectSession: (sessionPath) =>
    set({ selectedSessionPath: sessionPath }),

  clearRunSelection: () =>
    set({ selectedRunId: null }),

  clearFileSelection: () =>
    set({ selectedFile: null, selectedFileStaged: false }),

  clearCommitSelection: () =>
    set({ selectedCommitId: null }),

  clearStashSelection: () =>
    set({ selectedStashIndex: null }),

  clearAll: () =>
    set({
      selectedFile: null,
      selectedFileStaged: false,
      selectedCommitId: null,
      selectedStashIndex: null,
      selectedRunId: null,
      selectedSessionPath: null,
    }),
}));

// --- Cross-store auto-reset (registered once on module load) ---

// Repo change -> clear all selections
// (브랜치 전환 시 파일·커밋 선택 초기화는 switchBranch 실행 지점(BranchZone)에서
//  직접 처리한다. worktree 전환은 activeRepoPath 변경이라 아래 구독이 커버한다.)
let prevRepoPath = useRepositoryStore.getState().activeRepoPath;
useRepositoryStore.subscribe((state) => {
  if (state.activeRepoPath !== prevRepoPath) {
    prevRepoPath = state.activeRepoPath;
    useSelectionStore.getState().clearAll();
  }
});

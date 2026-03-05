import { create } from "zustand";
import { useRepositoryStore } from "./repository";
import { useBranchStore } from "./branch";

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

  // Actions
  selectFile: (path: string, staged: boolean) => void;
  selectCommit: (id: string) => void;
  selectStash: (index: number | null) => void;
  selectRun: (id: number) => void;
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

  selectFile: (path, staged) =>
    set({ selectedFile: path, selectedFileStaged: staged }),

  selectCommit: (id) =>
    set({ selectedCommitId: id }),

  selectStash: (index) =>
    set({ selectedStashIndex: index }),

  selectRun: (id) =>
    set({ selectedRunId: id }),

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
    }),
}));

// --- Cross-store auto-reset (registered once on module load) ---

// Repo change -> clear all selections
let prevRepoPath = useRepositoryStore.getState().activeRepoPath;
useRepositoryStore.subscribe((state) => {
  if (state.activeRepoPath !== prevRepoPath) {
    prevRepoPath = state.activeRepoPath;
    useSelectionStore.getState().clearAll();
  }
});

// Branch change -> clear file & commit selections (stash is branch-independent)
let prevBranch = useBranchStore.getState().currentBranch;
useBranchStore.subscribe((state) => {
  if (state.currentBranch !== prevBranch) {
    prevBranch = state.currentBranch;
    const { clearFileSelection, clearCommitSelection } = useSelectionStore.getState();
    clearFileSelection();
    clearCommitSelection();
  }
});

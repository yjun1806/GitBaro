import { create } from "zustand";
import { useRepositoryStore } from "./repository";

/**
 * The commit message being typed.
 *
 * It lives in a store rather than in `ChangesView` because the verification
 * panel sits in the content area and V6 (scope drift) compares the changed
 * paths against the message the user is writing right now.
 */
interface CommitDraftState {
  summary: string;
  description: string;
  setSummary: (summary: string) => void;
  setDescription: (description: string) => void;
  reset: () => void;
}

export const useCommitDraftStore = create<CommitDraftState>()((set) => ({
  summary: "",
  description: "",

  setSummary: (summary) => set({ summary }),

  setDescription: (description) => set({ description }),

  reset: () => set({ summary: "", description: "" }),
}));

// --- Cross-store auto-reset (registered once on module load) ---

// Repo change -> drop the draft, the same way selections are cleared.
let prevRepoPath = useRepositoryStore.getState().activeRepoPath;
useRepositoryStore.subscribe((state) => {
  if (state.activeRepoPath !== prevRepoPath) {
    prevRepoPath = state.activeRepoPath;
    useCommitDraftStore.getState().reset();
  }
});

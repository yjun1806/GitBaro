import { create } from "zustand";

export interface CommitDraft {
  summary: string;
  description: string;
}

export const EMPTY_COMMIT_DRAFT: CommitDraft = { summary: "", description: "" };

interface CommitDraftState {
  /** Unfinished commit message per repository path. */
  drafts: Record<string, CommitDraft>;
  setDraft: (repoPath: string, patch: Partial<CommitDraft>) => void;
  clearDraft: (repoPath: string) => void;
}

/**
 * Commit message drafts keyed by repository path. Lives outside the Changes
 * view so a draft survives switching tabs, and is keyed by repo so switching
 * repositories never carries a message over to another repo.
 */
export const useCommitDraftStore = create<CommitDraftState>()((set) => ({
  drafts: {},

  setDraft: (repoPath, patch) =>
    set((state) => ({
      drafts: {
        ...state.drafts,
        [repoPath]: { ...(state.drafts[repoPath] ?? EMPTY_COMMIT_DRAFT), ...patch },
      },
    })),

  clearDraft: (repoPath) =>
    set((state) => {
      if (!(repoPath in state.drafts)) return state;
      const { [repoPath]: _removed, ...rest } = state.drafts;
      return { drafts: rest };
    }),
}));

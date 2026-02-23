import { create } from "zustand";
import type { BranchInfo } from "@/types";

interface BranchState {
  branches: BranchInfo[];
  currentBranch: string | null;
  isLoading: boolean;
  setBranches: (branches: BranchInfo[]) => void;
  setCurrentBranch: (branch: string | null) => void;
  setLoading: (loading: boolean) => void;
}

export const useBranchStore = create<BranchState>((set) => ({
  branches: [],
  currentBranch: null,
  isLoading: false,

  setBranches: (branches) => set({ branches }),

  setCurrentBranch: (branch) => set({ currentBranch: branch }),

  setLoading: (loading) => set({ isLoading: loading }),
}));

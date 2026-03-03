import { create } from "zustand";
import type { GitCommandEntry } from "@/types";

const MAX_ENTRIES = 200;

interface ActivityState {
  entries: GitCommandEntry[];
  activeOperations: Record<string, GitCommandEntry>;
  addStart: (entry: GitCommandEntry) => void;
  addComplete: (id: string, result: Partial<GitCommandEntry>) => void;
  updateProgress: (
    id: string,
    message: string,
    percent?: number,
  ) => void;
  clearLog: () => void;
}

export const useActivityStore = create<ActivityState>((set) => ({
  entries: [],
  activeOperations: {},

  addStart: (entry) =>
    set((state) => {
      const { [entry.id]: _, ...rest } = state.activeOperations;
      return {
        entries: [entry, ...state.entries].slice(0, MAX_ENTRIES),
        activeOperations: { ...rest, [entry.id]: entry },
      };
    }),

  addComplete: (id, result) =>
    set((state) => {
      const { [id]: _, ...remainingOps } = state.activeOperations;
      return {
        entries: state.entries.map((e) =>
          e.id === id ? { ...e, ...result } : e,
        ),
        activeOperations: remainingOps,
      };
    }),

  updateProgress: (id, message, percent) =>
    set((state) => {
      const op = state.activeOperations[id];
      if (!op) return state;
      const updated = { ...op, progress: { message, percent } };
      return {
        entries: state.entries.map((e) => (e.id === id ? updated : e)),
        activeOperations: { ...state.activeOperations, [id]: updated },
      };
    }),

  clearLog: () =>
    set((state) => ({
      entries: state.entries.filter((e) => state.activeOperations[e.id]),
    })),
}));

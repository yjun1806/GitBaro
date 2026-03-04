import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { GitCommandEntry } from "@/types";

const MAX_STDOUT_PERSIST = 500;
const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;

function truncate(s: string | undefined, max: number): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function pruneOldEntries(entries: GitCommandEntry[]): GitCommandEntry[] {
  const cutoff = Date.now() - THREE_MONTHS_MS;
  return entries.filter((e) => e.startedAt >= cutoff);
}

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

export const useActivityStore = create<ActivityState>()(
  persist(
    (set) => ({
      entries: [],
      activeOperations: {},

      addStart: (entry) =>
        set((state) => ({
          entries: [entry, ...state.entries],
          activeOperations: { ...state.activeOperations, [entry.id]: entry },
        })),

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
    }),
    {
      name: "gitbaro-activity-log",
      partialize: (state) => ({
        entries: pruneOldEntries(
          state.entries
            .filter((e) => e.completedAt != null)
            .map((e) => ({
              ...e,
              stdout: truncate(e.stdout, MAX_STDOUT_PERSIST),
              stderr: truncate(e.stderr, MAX_STDOUT_PERSIST),
            })),
        ),
      }),
    },
  ),
);

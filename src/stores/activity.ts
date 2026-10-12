import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createDebouncedStorage } from "@/lib/debounced-storage";
import { createSafeStorage } from "@/lib/safe-storage";
import { useLiveOperationsStore } from "@/stores/live-operations";
import type { GitCommandEntry } from "@/types";

const MAX_STDOUT_PERSIST = 500;
/** git은 오류를 출력 끝에 쓰므로 저장할 때는 끝을 남긴다. */
const MAX_STDERR_PERSIST = 4096;

/**
 * 보관하는 최대 엔트리 수.
 *
 * 이전에는 개수 상한 없이 90일 만료만 있었고, 3분 주기 백그라운드 fetch가 저장소 수만큼
 * 기록을 남겨 8,586건 / 5MB까지 늘어났다(localStorage 쿼터를 소진해 다른 스토어의 저장이
 * 전부 실패했다). 같은 실패는 한 항목으로 합치므로(아래 collapse), 1,000건은 정상 사용에서
 * 걸리지 않는 안전핀이다.
 */
export const MAX_ENTRIES = 1000;

function truncateHead(s: string | undefined, max: number): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function truncateTail(s: string | undefined, max: number): string {
  if (!s) return "";
  return s.length > max ? "…" + s.slice(s.length - max) : s;
}

/** entries는 최신순이므로 앞에서부터 남긴다. */
function capEntries(entries: GitCommandEntry[]): GitCommandEntry[] {
  return entries.length > MAX_ENTRIES ? entries.slice(0, MAX_ENTRIES) : entries;
}

/** 저장용 모양: 진행률은 빼고 출력은 잘라낸다. */
function toPersisted(entry: GitCommandEntry): GitCommandEntry {
  const { progress: _progress, ...rest } = entry;
  return {
    ...rest,
    stdout: truncateHead(entry.stdout, MAX_STDOUT_PERSIST),
    stderr: truncateTail(entry.stderr, MAX_STDERR_PERSIST),
  };
}

function isEntryLike(value: unknown): value is GitCommandEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

/**
 * 저장된 값을 현재 모양으로 맞춘다. 예전 빌드가 남긴 `progress`와 긴 출력을 버리고,
 * 상한을 넘는 항목을 자른다. 깨진 값이면 기본값(빈 로그)으로 둔다.
 */
export function sanitizePersistedEntries(persisted: unknown): GitCommandEntry[] {
  const raw = (persisted as { entries?: unknown } | null | undefined)?.entries;
  if (!Array.isArray(raw)) return [];
  return capEntries(raw.filter(isEntryLike).map(toPersisted));
}

interface ActivityState {
  entries: GitCommandEntry[];
  addStart: (entry: GitCommandEntry) => void;
  addComplete: (id: string, result: Partial<GitCommandEntry>) => void;
  updateProgress: (id: string, message: string, percent?: number) => void;
  clearLog: () => void;
}

/** 직전 자동 실패와 같은 저장소·작업·오류인가. 같으면 새 항목 대신 횟수만 올린다. */
function isRepeatOfAutomaticFailure(
  previous: GitCommandEntry | undefined,
  next: GitCommandEntry,
): boolean {
  return (
    previous !== undefined &&
    previous.automatic === true &&
    previous.success === false &&
    previous.operation === next.operation &&
    (previous.stderr ?? "").trim() === (next.stderr ?? "").trim()
  );
}

export const useActivityStore = create<ActivityState>()(
  persist(
    (set) => ({
      entries: [],

      // 자동 작업은 진행 표시(live store)에만 올린다. 로그에 남길지는
      // 완료 시점에 성공 여부를 보고 정한다. 이 스토어는 건드리지 않으므로 저장도 일어나지 않는다.
      addStart: (entry) => {
        useLiveOperationsStore.getState().start(entry);
        if (entry.automatic) return;
        set((state) => ({ entries: capEntries([entry, ...state.entries]) }));
      },

      addComplete: (id, result) => {
        const live = useLiveOperationsStore.getState();
        const startedEntry = live.activeOperations[id];
        live.finish(id);

        set((state) => {
          if (state.entries.some((e) => e.id === id)) {
            return {
              entries: state.entries.map((e) =>
                e.id === id ? { ...e, ...result } : e,
              ),
            };
          }

          // 로그에 없는 건 자동 작업이다. 실패했을 때만 뒤늦게 남긴다.
          if (!startedEntry || result.success !== false) return state;
          const failed = { ...startedEntry, ...result, progress: undefined };

          const lastForRepo = state.entries.find(
            (e) => e.repoPath === failed.repoPath,
          );
          if (lastForRepo && isRepeatOfAutomaticFailure(lastForRepo, failed)) {
            const merged: GitCommandEntry = {
              ...lastForRepo,
              completedAt: failed.completedAt,
              durationMs: failed.durationMs,
              count: (lastForRepo.count ?? 1) + 1,
            };
            return {
              entries: [merged, ...state.entries.filter((e) => e !== lastForRepo)],
            };
          }
          return { entries: capEntries([failed, ...state.entries]) };
        });
      },

      // 진행률은 저장하지 않는 live store에만 쓴다. entries를 건드리면 persist가
      // 줄마다 로그 전체를 다시 저장한다.
      updateProgress: (id, message, percent) =>
        useLiveOperationsStore.getState().updateProgress(id, message, percent),

      clearLog: () =>
        set((state) => {
          const active = useLiveOperationsStore.getState().activeOperations;
          return { entries: state.entries.filter((e) => active[e.id]) };
        }),
    }),
    {
      name: "gitbaro-activity-log",
      // 진행률 폭주와 별개로, 짧은 시간에 여러 번 바뀌어도 쓰기를 합친다.
      storage: createJSONStorage(() => createDebouncedStorage(createSafeStorage())),
      // 끝난 항목만 저장한다(진행 중인 것은 live store의 몫).
      partialize: (state) => ({
        entries: state.entries.filter((e) => e.completedAt != null).map(toPersisted),
      }),
      merge: (persisted, current) => ({
        ...current,
        entries: sanitizePersistedEntries(persisted),
      }),
    },
  ),
);

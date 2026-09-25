import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createSafeStorage } from "@/lib/safe-storage";
import { trimTrailingSlash } from "@/lib/utils";
import type { BranchChangedFile } from "@/types";

/**
 * 파일 하나에 단 「봤음」 표시. 어느 브랜치를 어느 기준과 비교한 목록에서, 어떤 내용을 봤는지 기억한다.
 * 내용(`contentId`)이 지금 파일과 다르면 표시는 없는 것으로 본다(에이전트가 다시 고쳤다).
 */
export interface FileReviewMark {
  /** 검토한 브랜치. 체크아웃하지 않고 본 브랜치도 그 이름이다. detached HEAD면 `DETACHED`. */
  branch: string;
  /** 비교 기준 참조(`main`, `origin/main`, 고른 기준 브랜치). */
  base: string;
  path: string;
  contentId: string;
  /** 표시한 시각(ms). 개수 상한을 넘으면 오래된 것부터 버린다. */
  at: number;
}

/** 표시를 가르는 범위: 저장소 안의 (브랜치, 기준). */
export interface FileReviewScope {
  branch: string;
  base: string;
}

/** detached HEAD의 브랜치 자리. 브랜치 이름에 들어갈 수 없는 문자로 시작한다. */
export const DETACHED = "(detached)";

/** 저장소 하나가 기억하는 표시의 상한. 넘으면 오래된 것부터 버린다. */
export const MAX_MARKS_PER_REPO = 2000;

const STORE_VERSION = 0;

type RepoMarks = Readonly<Record<string, FileReviewMark>>;

interface FileReviewState {
  /** 저장소 경로(끝 `/` 없이) → 표시 키 → 표시. */
  marksByRepo: Readonly<Record<string, RepoMarks>>;
  /** 봤음 행을 목록 맨 아래 「봤음 N개」 한 줄로 접을지. */
  collapseViewed: boolean;
  /** 파일들을 봤음으로 표시한다. 이미 같은 내용으로 표시했으면 그대로 둔다. */
  markViewed: (repoPath: string, scope: FileReviewScope, files: readonly ReviewableFile[]) => void;
  unmarkViewed: (repoPath: string, scope: FileReviewScope, paths: readonly string[]) => void;
  /**
   * 새로 받은 목록과 맞춘다: 이 범위의 표시 중 목록에서 빠졌거나 내용이 바뀐 파일의 표시를 지운다.
   * 지울 것이 없으면 상태를 바꾸지 않는다.
   */
  reconcile: (repoPath: string, scope: FileReviewScope, files: readonly ReviewableFile[]) => void;
  /** 브랜치나 기준이 더는 없는 표시를 지운다. `refs`는 그 저장소의 로컬·원격 브랜치 이름이다. */
  pruneMissingRefs: (repoPath: string, refs: ReadonlySet<string>) => void;
  setCollapseViewed: (collapse: boolean) => void;
}

/** 표시할 수 있는 파일: 경로와 지금 내용 id. */
export interface ReviewableFile {
  path: string;
  contentId: string;
}

/** 목록 행의 내용 id. 지운 파일은 내용이 없어 「지움」 자체가 내용이다. */
export function fileContentId(file: Pick<BranchChangedFile, "status" | "blobId">): string {
  return file.blobId ?? `no-content:${file.status}`;
}

export function toReviewable(file: Pick<BranchChangedFile, "path" | "status" | "blobId">): ReviewableFile {
  return { path: file.path, contentId: fileContentId(file) };
}

function markKey(scope: FileReviewScope, path: string): string {
  return `${scope.branch}\u0000${scope.base}\u0000${path}`;
}

function repoKey(repoPath: string): string {
  return trimTrailingSlash(repoPath);
}

/** 이 파일을 지금 내용 그대로 봤는가. */
export function isViewed(marks: RepoMarks | undefined, scope: FileReviewScope, file: ReviewableFile): boolean {
  return marks?.[markKey(scope, file.path)]?.contentId === file.contentId;
}

/** 오래된 것부터 버려 상한에 맞춘다. */
function capMarks(marks: Record<string, FileReviewMark>): Record<string, FileReviewMark> {
  const entries = Object.entries(marks);
  if (entries.length <= MAX_MARKS_PER_REPO) return marks;
  return Object.fromEntries(entries.sort(([, a], [, b]) => b.at - a.at).slice(0, MAX_MARKS_PER_REPO));
}

/** 표시 하나를 거르는 조건으로 저장소 하나를 다시 만든다. 지운 것이 없으면 `null`. */
function filterRepo(marks: RepoMarks | undefined, keep: (mark: FileReviewMark) => boolean): RepoMarks | null {
  if (!marks) return null;
  const kept = Object.entries(marks).filter(([, mark]) => keep(mark));
  return kept.length === Object.keys(marks).length ? null : Object.fromEntries(kept);
}

function withRepo(
  all: Readonly<Record<string, RepoMarks>>,
  key: string,
  marks: RepoMarks,
): Readonly<Record<string, RepoMarks>> {
  const rest = Object.fromEntries(Object.entries(all).filter(([k]) => k !== key));
  return Object.keys(marks).length === 0 ? rest : { ...rest, [key]: marks };
}

function isMark(value: unknown): value is FileReviewMark {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.branch === "string" &&
    typeof v.base === "string" &&
    typeof v.path === "string" &&
    v.path !== "" &&
    typeof v.contentId === "string" &&
    typeof v.at === "number" &&
    Number.isFinite(v.at)
  );
}

/**
 * 저장된 값을 믿지 않고 한 칸씩 확인한다. 모양이 틀린 표시는 버리고, 키는 표시 내용으로 다시 만들고,
 * 저장소마다 상한을 적용한다.
 */
export function sanitizePersistedFileReview(persisted: unknown): Pick<FileReviewState, "marksByRepo" | "collapseViewed"> {
  const out: Record<string, RepoMarks> = {};
  const source = typeof persisted === "object" && persisted !== null ? (persisted as Record<string, unknown>) : {};
  const repos = source.marksByRepo;
  if (typeof repos === "object" && repos !== null) {
    for (const [repoPath, marks] of Object.entries(repos)) {
      if (typeof marks !== "object" || marks === null || !repoPath) continue;
      const clean: Record<string, FileReviewMark> = {};
      for (const mark of Object.values(marks)) {
        if (!isMark(mark)) continue;
        const { branch, base, path, contentId, at } = mark;
        clean[markKey({ branch, base }, path)] = { branch, base, path, contentId, at };
      }
      const capped = capMarks(clean);
      if (Object.keys(capped).length > 0) out[repoKey(repoPath)] = capped;
    }
  }
  return { marksByRepo: out, collapseViewed: source.collapseViewed === true };
}

/**
 * 파일별 「봤음」 표시. 저장소마다 기억하고 앱을 다시 켜도 남는다. 표시는 파일 내용 id에 묶여 있어서
 * 에이전트가 파일을 다시 고치면 저절로 풀린다(`isViewed`, `reconcile`).
 */
export const useFileReviewStore = create<FileReviewState>()(
  persist(
    (set) => ({
      marksByRepo: {},
      collapseViewed: false,

      markViewed: (repoPath, scope, files) =>
        set((state) => {
          const key = repoKey(repoPath);
          const current = state.marksByRepo[key] ?? {};
          const fresh = files.filter((file) => !isViewed(current, scope, file));
          if (fresh.length === 0) return state;
          const at = Date.now();
          const added = Object.fromEntries(
            fresh.map((file) => [
              markKey(scope, file.path),
              { branch: scope.branch, base: scope.base, path: file.path, contentId: file.contentId, at },
            ]),
          );
          return { marksByRepo: withRepo(state.marksByRepo, key, capMarks({ ...current, ...added })) };
        }),

      unmarkViewed: (repoPath, scope, paths) =>
        set((state) => {
          const key = repoKey(repoPath);
          const drop = new Set(paths.map((path) => markKey(scope, path)));
          const next = filterRepo(state.marksByRepo[key], (mark) => !drop.has(markKey(mark, mark.path)));
          return next ? { marksByRepo: withRepo(state.marksByRepo, key, next) } : state;
        }),

      reconcile: (repoPath, scope, files) =>
        set((state) => {
          const key = repoKey(repoPath);
          const current = new Map(files.map((file) => [file.path, file.contentId]));
          const next = filterRepo(
            state.marksByRepo[key],
            (mark) =>
              mark.branch !== scope.branch || mark.base !== scope.base || current.get(mark.path) === mark.contentId,
          );
          return next ? { marksByRepo: withRepo(state.marksByRepo, key, next) } : state;
        }),

      pruneMissingRefs: (repoPath, refs) =>
        set((state) => {
          const key = repoKey(repoPath);
          const next = filterRepo(
            state.marksByRepo[key],
            (mark) => (mark.branch === DETACHED || refs.has(mark.branch)) && refs.has(mark.base),
          );
          return next ? { marksByRepo: withRepo(state.marksByRepo, key, next) } : state;
        }),

      setCollapseViewed: (collapse) => set({ collapseViewed: collapse }),
    }),
    {
      name: "gitbaro-file-review",
      version: STORE_VERSION,
      storage: createJSONStorage(() => createSafeStorage()),
      partialize: (state) => ({ marksByRepo: state.marksByRepo, collapseViewed: state.collapseViewed }),
      merge: (persisted, current) => ({ ...current, ...sanitizePersistedFileReview(persisted) }),
    },
  ),
);

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createSafeStorage } from "@/lib/safe-storage";
import type { RepoReviewStatus, SeenRecordInput } from "@/types";

/**
 * 워크트리마다 「마지막으로 확인한 커밋」(기준선)을 기억한다. 새 커밋 수는 백엔드
 * `count_new_commits`가 이 기준선으로 센다(`src-tauri/src/git/new_commits.rs`).
 *
 * 기준선을 잡는 규칙:
 * - 첫 실행(`initialScanDone = false`): 그때 있는 모든 워크트리의 HEAD를 기준선으로 잡는다.
 * - 그 뒤 처음 나타난 링크된 워크트리: 기준선을 비워 둔다. 백엔드가 기반 브랜치에서
 *   갈라진 지점부터 센다. 에이전트가 워크트리를 만들고 커밋을 쌓은 뒤에 봐도 새 커밋이 보인다.
 * - 그 뒤 새로 추가된 저장소의 메인 작업 트리: 현재 HEAD를 기준선으로 잡는다.
 */

export const REVIEW_SEEN_STORAGE_KEY = "gitbaro-review-seen";
export const REVIEW_SEEN_VERSION = 1;

export interface SeenEntry {
  /** 확인할 때 체크아웃돼 있던 브랜치. detached HEAD면 null. */
  branch: string | null;
  /** 확인한 HEAD 커밋. */
  oid: string;
  /** 확인한 시각(epoch ms). 기준 커밋이 rebase·amend로 사라지면 이 시각으로 대신 판단한다. */
  seenAt: number;
}

/** 저장하는 부분. 형식을 바꾸면 `REVIEW_SEEN_VERSION`을 올리고 `migrateReviewSeen`에 변환을 더한다. */
export interface PersistedReviewSeen {
  /** 워크트리 경로 → 기준선. */
  entries: Record<string, SeenEntry>;
  initialScanDone: boolean;
}

interface ReviewSeenState extends PersistedReviewSeen {
  /** `review_status` 결과로 아직 기준선이 없는 워크트리의 기준선을 잡는다(위 규칙). */
  applyScan: (repos: RepoReviewStatus[], now?: number) => void;
  /** 「새 커밋 N개 확인함으로 표시」. 기준선을 지금 HEAD로 옮긴다. */
  markSeen: (path: string, headOid: string, branch: string | null) => void;
}

/**
 * 스캔 결과로 기준선을 잡은 새 상태. 바뀐 게 없으면 null.
 * 워크트리가 하나도 없는 스캔은 첫 실행으로 치지 않는다(저장소를 추가하기 전 첫 실행).
 */
export function baselinesFromScan(
  state: PersistedReviewSeen,
  repos: RepoReviewStatus[],
  now: number,
): PersistedReviewSeen | null {
  const worktrees = repos.flatMap((r) => r.worktrees);
  if (worktrees.length === 0) return null;

  const additions: Record<string, SeenEntry> = {};
  for (const wt of worktrees) {
    if (wt.headOid === null || state.entries[wt.path] !== undefined) continue;
    if (state.initialScanDone && !wt.isMain) continue;
    additions[wt.path] = { branch: wt.branch, oid: wt.headOid, seenAt: now };
  }

  if (state.initialScanDone && Object.keys(additions).length === 0) return null;
  return { entries: { ...state.entries, ...additions }, initialScanDone: true };
}

/** `count_new_commits`에 넘길 입력. HEAD가 없는 워크트리는 셀 게 없어 뺀다. */
export function buildCountInputs(
  repos: RepoReviewStatus[],
  entries: Record<string, SeenEntry>,
): SeenRecordInput[] {
  return repos
    .flatMap((r) => r.worktrees)
    .filter((wt) => wt.headOid !== null)
    .map((wt) => {
      const seen = entries[wt.path];
      return seen
        ? { path: wt.path, oid: seen.oid, seenAt: seen.seenAt, branch: seen.branch }
        : { path: wt.path };
    });
}

function isSeenEntry(value: unknown): value is SeenEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.oid === "string" &&
    v.oid.length > 0 &&
    typeof v.seenAt === "number" &&
    Number.isFinite(v.seenAt) &&
    (v.branch === null || typeof v.branch === "string")
  );
}

/** 저장값에서 형식이 맞는 항목만 고른다. 손으로 고친 값이나 깨진 값이 앱을 멈추지 않게 한다. */
export function sanitizePersistedReviewSeen(persisted: unknown): Partial<PersistedReviewSeen> {
  if (typeof persisted !== "object" || persisted === null) return {};
  const p = persisted as Record<string, unknown>;
  const out: Partial<PersistedReviewSeen> = {};
  if (typeof p.entries === "object" && p.entries !== null) {
    const entries: Record<string, SeenEntry> = {};
    for (const [path, entry] of Object.entries(p.entries as Record<string, unknown>)) {
      if (isSeenEntry(entry)) {
        entries[path] = { branch: entry.branch, oid: entry.oid, seenAt: entry.seenAt };
      }
    }
    out.entries = entries;
  }
  if (typeof p.initialScanDone === "boolean") out.initialScanDone = p.initialScanDone;
  return out;
}

/**
 * 저장 버전이 다를 때 zustand가 부른다. v1이 첫 형식이라 옮길 옛 형식은 없다.
 * 알 수 없는 버전(앞선 빌드가 쓴 값 등)은 알아볼 수 있는 항목만 남긴다.
 */
export function migrateReviewSeen(persisted: unknown, _version: number): PersistedReviewSeen {
  const clean = sanitizePersistedReviewSeen(persisted);
  return { entries: clean.entries ?? {}, initialScanDone: clean.initialScanDone ?? false };
}

export const useReviewSeenStore = create<ReviewSeenState>()(
  persist(
    (set) => ({
      entries: {},
      initialScanDone: false,

      applyScan: (repos, now = Date.now()) =>
        set((state) => baselinesFromScan(state, repos, now) ?? state),

      markSeen: (path, headOid, branch) =>
        set((state) => ({
          entries: { ...state.entries, [path]: { branch, oid: headOid, seenAt: Date.now() } },
        })),
    }),
    {
      name: REVIEW_SEEN_STORAGE_KEY,
      version: REVIEW_SEEN_VERSION,
      storage: createJSONStorage(() => createSafeStorage()),
      partialize: (state): PersistedReviewSeen => ({
        entries: state.entries,
        initialScanDone: state.initialScanDone,
      }),
      migrate: migrateReviewSeen,
      merge: (persisted, current) => ({ ...current, ...sanitizePersistedReviewSeen(persisted) }),
    },
  ),
);

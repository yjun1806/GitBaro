import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createSafeStorage } from "@/lib/safe-storage";
import { useRepositoryStore } from "@/stores/repository";
import type { RepoReviewStatus, SeenRecordInput } from "@/types";

/**
 * 워크트리마다 「마지막으로 확인한 커밋」(기준선)을 기억한다. 새 커밋 수는 백엔드
 * `count_new_commits`가 이 기준선으로 센다(`src-tauri/src/git/new_commits.rs`).
 *
 * 기준선을 잡는 규칙. 「첫 실행」은 저장소마다 따로 센다(`scannedRepos`):
 * - 저장소가 스캔에 처음 나타날 때(앱의 첫 실행, 첫 실행 때 열 수 없던 저장소가 돌아왔을 때,
 *   나중에 추가된 저장소): 그 저장소에 그때 있는 모든 워크트리의 HEAD를 기준선으로 잡는다.
 *   사용자가 이미 알던 커밋을 새 커밋으로 보이지 않게 한다. 나중에 추가된 저장소의 메인
 *   작업 트리가 현재 HEAD를 기준선으로 잡는 것도 이 규칙에 들어간다.
 * - 그 저장소를 한 번 스캔한 뒤 처음 나타난 링크된 워크트리: 기준선을 비워 둔다. 백엔드가
 *   기반 브랜치에서 갈라진 지점부터 센다. 에이전트가 워크트리를 만들고 커밋을 쌓은 뒤에 봐도
 *   새 커밋이 보인다.
 * - 그 저장소의 메인 작업 트리에 기준선이 없으면(그때는 커밋이 없었음 등) 현재 HEAD로 잡는다.
 *
 * `initialScanDone`은 저장소가 하나라도 스캔된 뒤 true다. 개수 세기는 이 값이 true일 때부터 한다.
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
  /** 한 번이라도 스캔된 저장소 경로(`review_status`의 `repoPath`). */
  scannedRepos: string[];
  /**
   * 저장소 경로 → 마지막으로 스캔에서 본 그 저장소의 워크트리 경로 목록(메인 포함).
   * `forgetRepos`가 저장소를 뺄 때 경로 접두어 대신 이 목록으로 정확히 지운다 — 앱이
   * 기본 제안하는 워크트리 위치(`${parent}/${repo}-${branch}`)는 저장소 폴더 밖이라
   * 접두어로는 찾을 수 없다.
   */
  worktreesByRepo: Record<string, string[]>;
}

interface ReviewSeenState extends PersistedReviewSeen {
  /** `review_status` 결과로 아직 기준선이 없는 워크트리의 기준선을 잡는다(위 규칙). */
  applyScan: (repos: RepoReviewStatus[], now?: number) => void;
  /** 「새 커밋 N개 확인함으로 표시」. 기준선을 지금 HEAD로 옮긴다. */
  markSeen: (path: string, headOid: string, branch: string | null) => void;
  /**
   * 저장소가 목록에서 빠지면 그 `scannedRepos` 기록과 워크트리 기준선을 지운다.
   * 지우지 않으면 같은 저장소를 다시 추가했을 때 「첫 실행」으로 다시 잡히지 않고
   * 옛 기준선 그대로 남아, 그 사이 쌓인 커밋이 전부 새 커밋으로 보인다.
   */
  forgetRepos: (repoPaths: string[]) => void;
}

/** `path`가 `repoPath` 자신이거나(메인 작업 트리) 그 아래(링크된 워크트리)인지. */
function belongsToRepo(path: string, repoPath: string): boolean {
  return path === repoPath || path.startsWith(`${repoPath}/`);
}

/**
 * 스캔 결과로 기준선을 잡은 새 상태. 바뀐 게 없으면 null.
 * 저장소가 하나도 없는 스캔은 첫 실행으로 치지 않는다(저장소를 추가하기 전 첫 실행).
 */
/** `a`(기록된 목록, 없으면 undefined)와 `b`(이번 스캔 목록)가 같은 경로 집합인지. */
function sameWorktreeList(a: string[] | undefined, b: string[]): boolean {
  if (a === undefined || a.length !== b.length) return false;
  const sa = new Set(a);
  return b.every((p) => sa.has(p));
}

export function baselinesFromScan(
  state: PersistedReviewSeen,
  repos: RepoReviewStatus[],
  now: number,
): PersistedReviewSeen | null {
  if (repos.length === 0) return null;

  const known = new Set(state.scannedRepos);
  const firstSeenRepos = repos.map((r) => r.repoPath).filter((p) => !known.has(p));
  const additions: Record<string, SeenEntry> = {};
  let worktreesByRepo = state.worktreesByRepo;
  let worktreesChanged = false;
  for (const repo of repos) {
    const firstScan = !known.has(repo.repoPath);
    const paths = repo.worktrees.map((wt) => wt.path);
    if (!sameWorktreeList(worktreesByRepo[repo.repoPath], paths)) {
      if (!worktreesChanged) worktreesByRepo = { ...worktreesByRepo };
      worktreesChanged = true;
      worktreesByRepo[repo.repoPath] = paths;
    }
    for (const wt of repo.worktrees) {
      if (wt.headOid === null || state.entries[wt.path] !== undefined) continue;
      if (!firstScan && !wt.isMain) continue;
      additions[wt.path] = { branch: wt.branch, oid: wt.headOid, seenAt: now };
    }
  }

  const unchanged =
    state.initialScanDone &&
    firstSeenRepos.length === 0 &&
    Object.keys(additions).length === 0 &&
    !worktreesChanged;
  if (unchanged) return null;
  return {
    entries: { ...state.entries, ...additions },
    initialScanDone: true,
    scannedRepos: [...state.scannedRepos, ...new Set(firstSeenRepos)],
    worktreesByRepo,
  };
}

/**
 * `count_new_commits`에 넘길 입력. HEAD가 없는 워크트리는 셀 게 없어 뺀다.
 * 아직 스캔 기록이 없는 저장소도 뺀다. 기준선을 잡기 전에 세면 기존 워크트리가 잠깐
 * 갈라진 지점부터 센 큰 숫자로 보인다.
 */
export function buildCountInputs(
  repos: RepoReviewStatus[],
  entries: Record<string, SeenEntry>,
  scannedRepos: string[],
): SeenRecordInput[] {
  const scanned = new Set(scannedRepos);
  return repos
    .filter((r) => scanned.has(r.repoPath))
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
  if (Array.isArray(p.scannedRepos)) {
    out.scannedRepos = p.scannedRepos.filter((r): r is string => typeof r === "string");
  }
  if (typeof p.worktreesByRepo === "object" && p.worktreesByRepo !== null) {
    const worktreesByRepo: Record<string, string[]> = {};
    for (const [repoPath, paths] of Object.entries(p.worktreesByRepo as Record<string, unknown>)) {
      if (Array.isArray(paths)) {
        worktreesByRepo[repoPath] = paths.filter((v): v is string => typeof v === "string");
      }
    }
    out.worktreesByRepo = worktreesByRepo;
  }
  return out;
}

/**
 * 저장 버전이 다를 때 zustand가 부른다. v1이 첫 형식이라 옮길 옛 형식은 없다.
 * 알 수 없는 버전(앞선 빌드가 쓴 값 등)은 알아볼 수 있는 항목만 남긴다.
 */
export function migrateReviewSeen(persisted: unknown, _version: number): PersistedReviewSeen {
  const clean = sanitizePersistedReviewSeen(persisted);
  return {
    entries: clean.entries ?? {},
    initialScanDone: clean.initialScanDone ?? false,
    scannedRepos: clean.scannedRepos ?? [],
    // v1 저장값에는 없던 필드. 다음 스캔이 다시 채운다(baselinesFromScan).
    worktreesByRepo: clean.worktreesByRepo ?? {},
  };
}

export const useReviewSeenStore = create<ReviewSeenState>()(
  persist(
    (set) => ({
      entries: {},
      initialScanDone: false,
      scannedRepos: [],
      worktreesByRepo: {},

      applyScan: (repos, now = Date.now()) =>
        set((state) => baselinesFromScan(state, repos, now) ?? state),

      markSeen: (path, headOid, branch) =>
        set((state) => ({
          entries: { ...state.entries, [path]: { branch, oid: headOid, seenAt: Date.now() } },
        })),

      forgetRepos: (repoPaths) =>
        set((state) => {
          if (repoPaths.length === 0) return state;
          const gone = new Set(repoPaths);
          // 접두어 판정(belongsToRepo)만으로는 저장소 폴더 밖에 만든 워크트리(앱이 기본
          // 제안하는 위치 포함)를 찾지 못한다. 마지막 스캔이 기록해 둔 정확한 목록을 더한다.
          const explicitPaths = new Set(repoPaths.flatMap((p) => state.worktreesByRepo[p] ?? []));
          const entries = Object.fromEntries(
            Object.entries(state.entries).filter(
              ([path]) =>
                !explicitPaths.has(path) &&
                ![...gone].some((repoPath) => belongsToRepo(path, repoPath)),
            ),
          );
          const worktreesByRepo = { ...state.worktreesByRepo };
          for (const p of repoPaths) delete worktreesByRepo[p];
          return {
            entries,
            scannedRepos: state.scannedRepos.filter((p) => !gone.has(p)),
            worktreesByRepo,
          };
        }),
    }),
    {
      name: REVIEW_SEEN_STORAGE_KEY,
      version: REVIEW_SEEN_VERSION,
      storage: createJSONStorage(() => createSafeStorage()),
      partialize: (state): PersistedReviewSeen => ({
        entries: state.entries,
        initialScanDone: state.initialScanDone,
        scannedRepos: state.scannedRepos,
        worktreesByRepo: state.worktreesByRepo,
      }),
      migrate: migrateReviewSeen,
      merge: (persisted, current) => ({ ...current, ...sanitizePersistedReviewSeen(persisted) }),
    },
  ),
);

/**
 * 저장소를 목록에서 지우면 기준선 기록도 지운다(`workspace.ts`의 같은 구독과
 * 같은 이유). 두 스토어가 모두 복원된 뒤에만 돈다 — 복원 전의 빈 `repos`를
 * 「모두 지워짐」으로 읽으면 기준선이 전부 지워지는 사고가 난다.
 */
useRepositoryStore.subscribe((next, prev) => {
  if (next.repos === prev.repos) return;
  if (!useRepositoryStore.persist.hasHydrated() || !useReviewSeenStore.persist.hasHydrated()) {
    return;
  }
  const nextPaths = new Set(next.repos.map((r) => r.path));
  const removed = prev.repos.map((r) => r.path).filter((p) => !nextPaths.has(p));
  if (removed.length > 0) useReviewSeenStore.getState().forgetRepos(removed);
});

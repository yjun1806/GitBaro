import type { RepoReviewStatus } from "@/types";

/** 워크트리 하나의 마지막으로 본 HEAD. */
export interface HeadRecord {
  repoPath: string;
  branch: string | null;
  headOid: string;
  /**
   * 이 HEAD 를 마지막으로 확인한 시각(epoch ms). 읽을 때마다 새로 적어, HEAD 가 바뀐 것을 본 때와의
   * 사이에 앱 안 작업이 있었는지 가릴 때 쓴다.
   */
  seenAt: number;
}

/** 워크트리 경로 → 마지막으로 본 HEAD. 메모리에만 둔다. */
export type HeadSnapshot = Record<string, HeadRecord>;

/** 같은 브랜치에서 HEAD 가 다른 커밋으로 옮겨 간 것. 앞으로 나아갔는지는 백엔드가 가린다. */
export interface HeadMove {
  repoPath: string;
  worktreePath: string;
  branch: string | null;
  from: string;
  to: string;
  /** 옮기기 전 HEAD 를 마지막으로 확인한 시각. */
  previousSeenAt: number;
}

/**
 * 새로 읽은 워크트리 목록을 앞 기록과 견줘, 같은 브랜치에서 HEAD 가 바뀐 곳을 찾는다.
 *
 * - 처음 보는 워크트리(앱 시작, 새 저장소·워크트리)는 기록만 하고 알리지 않는다.
 * - 브랜치가 바뀌었으면(체크아웃) 기록만 새로 한다. 옮겨 간 브랜치가 앞선 커밋이어도 새 커밋이 아니다.
 * - 커밋이 없는 워크트리(HEAD 가 null)는 기록하지 않는다. 첫 커밋은 그다음 커밋부터 알린다.
 * - 목록에서 사라진 워크트리는 기록에서 뺀다.
 */
export function diffHeads(
  previous: HeadSnapshot,
  repos: readonly RepoReviewStatus[],
  now: number,
): { next: HeadSnapshot; moves: HeadMove[] } {
  const next: HeadSnapshot = {};
  const moves: HeadMove[] = [];
  for (const repo of repos) {
    for (const wt of repo.worktrees) {
      if (!wt.headOid) continue;
      const before = previous[wt.path];
      next[wt.path] = { repoPath: repo.repoPath, branch: wt.branch, headOid: wt.headOid, seenAt: now };
      if (before && before.headOid !== wt.headOid && before.branch === wt.branch) {
        moves.push({
          repoPath: repo.repoPath,
          worktreePath: wt.path,
          branch: wt.branch,
          from: before.headOid,
          to: wt.headOid,
          previousSeenAt: before.seenAt,
        });
      }
    }
  }
  return { next, moves };
}

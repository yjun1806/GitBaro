import { distinctTicketKeys } from "@/lib/ticket-keys";
import type { CommitTouch, FileTouches, RepoFileTouches } from "@/types";

/**
 * 워크스페이스 리뷰의 「파일별 보기」 판단 규칙(순수 함수). `useUnpushedFileTouches`가 저장소마다
 * 따로 돌려주는 `RepoFileTouches`를 하나의 파일 목록으로 묶는다.
 */

/** 파일 목록 한 줄: 어느 저장소의 어느 파일인지 + 그 파일을 건드린 커밋들. */
export interface FileTouchRow {
  /** 저장소 경로 + 파일 경로로 만든 고유 키(같은 경로가 저장소마다 따로 있을 수 있다). */
  key: string;
  repoPath: string;
  touches: FileTouches;
  /** 이 저장소의 범위 아래 커밋(합친 diff의 옛 쪽). `getRangeFileDiff`에 그대로 넘긴다. */
  rangeBase: string | null;
  /** 이 저장소의 HEAD(합친 diff의 새 쪽). */
  head: string | null;
}

export function fileTouchKey(repoPath: string, path: string): string {
  return `${repoPath}\u0000${path}`;
}

export interface FileTouchRepoError {
  repoPath: string;
  error: string;
}

export interface GroupedFileTouches {
  /** 커밋 2개 이상이 건드린 파일, 가장 최근 커밋 시각 순. */
  multi: FileTouchRow[];
  /** 커밋 하나만 건드린 파일, 가장 최근 커밋 시각 순. */
  single: FileTouchRow[];
  /** 읽지 못한 저장소. */
  errors: FileTouchRepoError[];
  /** 오래된 커밋 일부를 보지 않은 저장소. */
  truncatedRepos: string[];
  /** 하나라도 아직 못 읽었으면 true. */
  isLoading: boolean;
}

/** 파일이 건드린 커밋 중 가장 최근 시각(정렬 기준). `commits`는 이미 최신 순이다. */
function newestTouchTime(row: FileTouchRow): number {
  return row.touches.commits[0]?.authorTime ?? 0;
}

function byRecency(a: FileTouchRow, b: FileTouchRow): number {
  return newestTouchTime(b) - newestTouchTime(a);
}

/**
 * `paths`와 같은 순서의 `useUnpushedFileTouches` 결과를 파일별 보기 한 목록으로 묶는다.
 * 커밋 2개 이상이 건드린 파일을 먼저, 그다음 커밋 하나만 건드린 파일을 두며, 각 묶음 안은
 * 가장 최근 커밋 시각 순이다(저장소를 넘나들어도 하나의 시각 기준으로 다시 정렬한다).
 */
export function groupFileTouches(
  paths: readonly string[],
  results: readonly (RepoFileTouches | undefined)[],
): GroupedFileTouches {
  const isLoading = results.some((r) => r === undefined);
  const errors: FileTouchRepoError[] = [];
  const truncatedRepos: string[] = [];
  const rows: FileTouchRow[] = [];

  results.forEach((result, i) => {
    if (!result) return;
    const repoPath = paths[i];
    if (result.error) {
      errors.push({ repoPath, error: result.error });
      return;
    }
    if (result.truncated) truncatedRepos.push(repoPath);
    for (const touches of result.files) {
      rows.push({
        key: fileTouchKey(repoPath, touches.path),
        repoPath,
        touches,
        rangeBase: result.rangeBase,
        head: result.head,
      });
    }
  });

  return {
    multi: rows.filter((r) => r.touches.commits.length > 1).sort(byRecency),
    single: rows.filter((r) => r.touches.commits.length === 1).sort(byRecency),
    errors,
    truncatedRepos,
    isLoading,
  };
}

/**
 * 파일의 커밋 제목에 서로 다른 이슈 키가 둘 이상 있으면 그 키들(나온 순서대로). 하나 이하면 빈 배열
 * — 「XMS-371, XMS-364가 바꿈」 같은 안내는 여러 작업이 겹칠 때만 뜻이 있다.
 */
export function ticketNoteKeys(commits: readonly CommitTouch[]): string[] {
  const keys = distinctTicketKeys(commits.map((c) => c.subject));
  return keys.length > 1 ? keys : [];
}

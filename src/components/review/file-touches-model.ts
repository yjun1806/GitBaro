import { distinctTicketKeys } from "@/lib/ticket-keys";
import type { FileTouchesState } from "@/api/queries";
import type { CommitTouch, FileTouches, ReviewWorktree } from "@/types";
import { baseName } from "./review-model";

/**
 * 워크스페이스 리뷰의 「파일별 보기」 판단 규칙(순수 함수). `useUnpushedFileTouches`가 워크트리마다
 * 따로 돌려주는 결과를 하나의 파일 목록으로 묶는다.
 */

/** 파일별 보기에서 읽을 워크트리 하나. */
export interface FileTouchSource {
  /** 저장소 경로(이름·색을 고르는 데 쓴다). */
  repoPath: string;
  /** 워크트리 경로(git을 읽는 곳). 메인 작업 트리면 `repoPath`와 같다. */
  path: string;
  /** 메인 작업 트리가 아니면 워크트리를 가리키는 이름(브랜치, detached면 폴더 이름). 메인이면 null. */
  worktreeLabel: string | null;
}

/**
 * 보이는 저장소들의 워크트리를 파일별 보기의 조회 대상으로 편다. 메인 작업 트리를 먼저 둔다.
 * 같은 저장소에서 HEAD가 같은 워크트리는 원격에 없는 커밋도 같으므로 앞의 하나만 둔다
 * (같은 브랜치는 두 워크트리에 체크아웃할 수 없어, 겹치는 건 같은 커밋의 detached HEAD뿐이다).
 */
export function fileTouchSources(
  repos: readonly { path: string; worktrees: readonly ReviewWorktree[] }[],
): FileTouchSource[] {
  return repos.flatMap((repo) => {
    const seenHeads = new Set<string>();
    const ordered = [...repo.worktrees].sort((a, b) => Number(b.isMain) - Number(a.isMain));
    return ordered.flatMap((w) => {
      if (w.headOid !== null) {
        if (seenHeads.has(w.headOid)) return [];
        seenHeads.add(w.headOid);
      }
      return [{ repoPath: repo.path, path: w.path, worktreeLabel: w.isMain ? null : (w.branch ?? baseName(w.path)) }];
    });
  });
}

/** 파일 목록 한 줄: 어느 워크트리의 어느 파일인지 + 그 파일을 건드린 커밋들. */
export interface FileTouchRow {
  /** 워크트리 경로 + 파일 경로로 만든 고유 키(같은 경로가 워크트리마다 따로 있을 수 있다). */
  key: string;
  source: FileTouchSource;
  touches: FileTouches;
  /** 이 워크트리의 합친 diff 옛 쪽. `getRangeFileDiff`에 그대로 넘긴다. */
  rangeBase: string | null;
  /** 이 워크트리의 HEAD(합친 diff의 새 쪽). */
  head: string | null;
}

export function fileTouchKey(worktreePath: string, path: string): string {
  return `${worktreePath}\u0000${path}`;
}

export interface FileTouchSourceError {
  source: FileTouchSource;
  error: string;
}

export interface FileTouchSourceMerges {
  source: FileTouchSource;
  count: number;
}

export interface GroupedFileTouches {
  /** 커밋 2개 이상이 건드린 파일, 가장 늦은 커밋 시각 순. */
  multi: FileTouchRow[];
  /** 커밋 하나만 건드린 파일, 가장 늦은 커밋 시각 순. */
  single: FileTouchRow[];
  /** 병합 커밋에서만 바뀐 파일(충돌 해결 등). 경로 순. */
  mergeOnly: FileTouchRow[];
  /** 아직 읽는 중인 워크트리. */
  pending: FileTouchSource[];
  /** 읽지 못한 워크트리(백엔드가 알린 이유, 또는 호출 자체의 실패). */
  errors: FileTouchSourceError[];
  /** 오래된 커밋 일부를 보지 않은 워크트리. */
  truncated: FileTouchSource[];
  /** 파일별 커밋 목록에서 뺀 병합 커밋이 있는 워크트리. */
  merges: FileTouchSourceMerges[];
}

/**
 * 파일의 정렬 시각: 그 파일을 건드린 커밋 중 가장 늦은 작성 시각. 커밋이 없으면 0.
 * 백엔드(`file_touches.rs`의 `latest_touch_time`)와 같은 규칙이다. `commits[0]`은 걸음 순서라
 * rebase한 커밋처럼 작성 시각이 거꾸로면 가장 늦은 시각이 아니다.
 */
export function latestTouchTime(touches: FileTouches): number {
  return touches.commits.reduce((latest, c) => Math.max(latest, c.authorTime), 0);
}

function byRecency(a: FileTouchRow, b: FileTouchRow): number {
  return latestTouchTime(b.touches) - latestTouchTime(a.touches) || a.touches.path.localeCompare(b.touches.path);
}

/**
 * `sources`와 같은 순서의 `useUnpushedFileTouches` 결과를 파일별 보기 한 목록으로 묶는다.
 * 커밋 2개 이상이 건드린 파일, 커밋 하나만 건드린 파일, 병합에서만 바뀐 파일 순이며, 각 묶음 안은
 * 가장 늦은 커밋 시각 순이다(저장소를 넘나들어 하나의 기준으로 다시 정렬한다). 읽는 중이거나 읽지 못한
 * 워크트리는 따로 모아, 다른 워크트리의 파일을 가리지 않는다.
 */
export function groupFileTouches(
  sources: readonly FileTouchSource[],
  results: readonly FileTouchesState[],
): GroupedFileTouches {
  const grouped: GroupedFileTouches = {
    multi: [],
    single: [],
    mergeOnly: [],
    pending: [],
    errors: [],
    truncated: [],
    merges: [],
  };
  const rows: FileTouchRow[] = [];

  sources.forEach((source, i) => {
    const state = results[i] ?? { status: "pending" };
    if (state.status === "pending") {
      grouped.pending.push(source);
      return;
    }
    if (state.status === "error") {
      grouped.errors.push({ source, error: state.error });
      return;
    }
    const result = state.data;
    if (result.error) {
      grouped.errors.push({ source, error: result.error });
      return;
    }
    if (result.truncated) grouped.truncated.push(source);
    if (result.merges > 0) grouped.merges.push({ source, count: result.merges });
    for (const touches of result.files) {
      rows.push({
        key: fileTouchKey(source.path, touches.path),
        source,
        touches,
        rangeBase: result.rangeBase,
        head: result.head,
      });
    }
  });

  return {
    ...grouped,
    multi: rows.filter((r) => r.touches.commits.length > 1).sort(byRecency),
    single: rows.filter((r) => r.touches.commits.length === 1).sort(byRecency),
    mergeOnly: rows.filter((r) => r.touches.commits.length === 0).sort(byRecency),
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

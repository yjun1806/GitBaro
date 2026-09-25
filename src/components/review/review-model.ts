/**
 * 워크스페이스 리뷰 화면의 판단 규칙(순수 함수).
 */

/** 저장소 숨김 판단에 쓰는 값. */
export interface ReviewRepoSignals {
  /** 지금 체크아웃한 브랜치. detached HEAD면 null. */
  branch: string | null;
  /** 저장소의 기본 브랜치(`get_workspace_history`). 모르면 null. */
  defaultBranch: string | null;
  /**
   * 모든 워크트리(메인 작업 트리 포함)에서 원격에 없는 커밋 수 합. 하나도 못 셌으면 null(0으로 본다).
   * 에이전트 워크트리에만 원격에 없는 커밋이 있어도 저장소가 보인다.
   */
  unpushedCount: number | null;
  /** 모든 워크트리의 커밋하지 않은 파일 수 합. */
  wipCount: number;
  /** 저장소를 읽지 못했으면 그 이유. */
  error: string | null;
}

const FALLBACK_DEFAULT_BRANCHES = new Set(["main", "master"]);

/** 지금 브랜치가 기본 브랜치인지. 기본 브랜치를 모르면 main·master를 기본 브랜치로 본다. */
export function isOnDefaultBranch(branch: string | null, defaultBranch: string | null): boolean {
  if (branch === null) return false;
  return defaultBranch !== null ? branch === defaultBranch : FALLBACK_DEFAULT_BRANCHES.has(branch);
}

/**
 * 리뷰 화면에서 접어 둘 저장소인지(질문 2 기본값). 현재 브랜치가 main이고 원격에 없는 커밋도
 * 커밋하지 않은 변경도 없으면 숨긴다. 읽지 못한 저장소와 detached HEAD는 숨기지 않는다(확인할 거리가 있다).
 */
export function isHiddenReviewRepo(s: ReviewRepoSignals): boolean {
  if (s.error !== null) return false;
  if (!isOnDefaultBranch(s.branch, s.defaultBranch)) return false;
  return (s.unpushedCount ?? 0) === 0 && s.wipCount === 0;
}

/** 보일 저장소와 숨긴 수. `showAll`이면 모두 보인다. 입력 순서를 지킨다. */
export function splitReviewRepos<T extends ReviewRepoSignals>(
  repos: readonly T[],
  showAll: boolean,
): { visible: T[]; hiddenCount: number } {
  const visible = showAll ? [...repos] : repos.filter((r) => !isHiddenReviewRepo(r));
  return { visible, hiddenCount: repos.length - visible.length };
}

/** 저장소 하나와 그 워크트리 경로. */
export interface ReviewRepoPaths {
  repoPath: string;
  worktreePaths: readonly string[];
}

function trimSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function covers(root: string, path: string): boolean {
  const r = trimSlash(root);
  return path === r || path.startsWith(`${r}/`);
}

/** 활동 이벤트가 가리키는 워크트리(메인 작업 트리 포함)와 그 저장소. */
export interface ActivityTarget {
  repoPath: string;
  /** 이벤트 경로를 담는 가장 깊은 저장소·워크트리 경로. */
  root: string;
}

/**
 * `repo:activity`의 경로가 어느 워크트리의 것인지. 저장소 경로와 워크트리 경로 중 이벤트 경로를
 * 담는 가장 깊은 경로를 고른다(저장소 안에 든 `.worktrees/x` 같은 워크트리가 바깥 저장소로
 * 잘못 가지 않게). 워크스페이스 밖의 경로면 null.
 */
export function activityTargetOf(path: string, repos: readonly ReviewRepoPaths[]): ActivityTarget | null {
  const target = trimSlash(path);
  let best: (ActivityTarget & { depth: number }) | null = null;
  for (const repo of repos) {
    for (const root of [repo.repoPath, ...repo.worktreePaths]) {
      if (!covers(root, target)) continue;
      const depth = trimSlash(root).length;
      if (!best || depth > best.depth) best = { repoPath: repo.repoPath, root, depth };
    }
  }
  return best ? { repoPath: best.repoPath, root: best.root } : null;
}

/**
 * 워크트리 하나에 활동이 있을 때 무효화할 쿼리 키(앞부분 일치). 그 워크트리의 커밋하지 않은
 * 변경(`status`)과 열린 파일 diff만 다시 읽는다. 같은 저장소의 다른 워크트리와 타임라인은
 * 다시 읽지 않는다. 파일 저장은 커밋 이력을 바꾸지 않고, 커밋(HEAD 이동)은 타임라인 키의
 * `headOid`가 20초 스캔에서 잡는다.
 */
export function activityInvalidationKeys(root: string): unknown[][] {
  return [
    ["status", root],
    ["fileDiff", root],
  ];
}

/** 경로의 마지막 부분(저장소·워크트리 이름). */
export function baseName(path: string): string {
  const trimmed = trimSlash(path);
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || path;
}

import type { BranchInfo, FileStatus, PrFileStatus, PrReviewThread, PullRequestSummary } from "@/types";

/** GitHub 파일 상태 → 앱의 파일 상태 배지. */
export function fileStatusOf(status: PrFileStatus): FileStatus {
  switch (status) {
    case "added":
      return "added";
    case "removed":
      return "deleted";
    case "renamed":
      return "renamed";
    case "copied":
      return "copied";
    default:
      return "modified";
  }
}

/**
 * 목록 순서: 지금 체크아웃한 브랜치의 열린 PR(같은 저장소 브랜치)을 맨 위로 올리고 표시한다.
 * 나머지는 받은 순서(최근에 고친 순서) 그대로다.
 */
export function orderForBranch(
  prs: readonly PullRequestSummary[],
  currentBranch: string | null,
): { pr: PullRequestSummary; isCurrent: boolean }[] {
  const isCurrent = (pr: PullRequestSummary) =>
    currentBranch !== null && pr.state === "open" && !pr.isCrossRepository && pr.headRef === currentBranch;
  const current = prs.filter(isCurrent);
  const rest = prs.filter((pr) => !isCurrent(pr));
  return [...current.map((pr) => ({ pr, isCurrent: true })), ...rest.map((pr) => ({ pr, isCurrent: false }))];
}

export interface FileThreads {
  /** 지금 diff에 자리가 있는 스레드. 줄 순서. */
  current: PrReviewThread[];
  /** 코드가 바뀌어 자리를 잃은 스레드. */
  outdated: PrReviewThread[];
}

/** 스레드의 줄. 자리를 잃었으면 코멘트를 달 때의 줄. */
export function threadLine(thread: PrReviewThread): number | null {
  return thread.line ?? thread.originalLine;
}

/**
 * 스레드를 파일마다 나누고, 자리가 있는 것과 잃은 것(outdated)을 가른다. 줄이 없는 스레드(파일에 단
 * 코멘트)는 자리가 있는 쪽 맨 앞에 둔다.
 */
export function threadsByFile(threads: readonly PrReviewThread[]): Map<string, FileThreads> {
  const map = new Map<string, FileThreads>();
  for (const thread of threads) {
    let entry = map.get(thread.path);
    if (!entry) {
      entry = { current: [], outdated: [] };
      map.set(thread.path, entry);
    }
    (thread.isOutdated ? entry.outdated : entry.current).push(thread);
  }
  const byLine = (a: PrReviewThread, b: PrReviewThread) => (threadLine(a) ?? 0) - (threadLine(b) ?? 0);
  for (const entry of map.values()) {
    entry.current.sort(byLine);
    entry.outdated.sort(byLine);
  }
  return map;
}

/** 파일 목록 배지에 보일, 아직 해결하지 않은 스레드 수. */
export function openThreadCount(entry: FileThreads | undefined): number {
  if (!entry) return 0;
  return [...entry.current, ...entry.outdated].filter((t) => !t.isResolved).length;
}

/**
 * 스레드를 누르면 diff에서 보여 줄 새 쪽 줄. DiffViewer는 새 쪽 줄로만 스크롤하므로 지운 쪽(left)
 * 스레드와 자리를 잃은 스레드는 null이다.
 */
export function revealLineOf(thread: PrReviewThread): number | null {
  return thread.side === "right" && !thread.isOutdated ? thread.line : null;
}

/** ISO 시각 → 유닉스 초(`formatRelativeTime`이 받는 값). 읽지 못하면 null. */
export function isoToSeconds(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

/**
 * PR의 head 브랜치를 이 저장소에서 부르는 이름. 로컬 브랜치가 있으면 그것, 없으면 원격 브랜치
 * (`origin`을 먼저 본다). 포크에서 온 PR은 이 저장소 원격에 그 브랜치가 없으니 null.
 */
export function headBranchRefs(
  pr: Pick<PullRequestSummary, "headRef" | "isCrossRepository">,
  branches: readonly BranchInfo[] | undefined,
  remoteNames: readonly string[],
): { local: string | null; remote: string | null } {
  if (pr.isCrossRepository || !branches) return { local: null, remote: null };
  const local = branches.some((b) => !b.isRemote && b.name === pr.headRef) ? pr.headRef : null;
  const ordered = [...remoteNames].sort((a, b) => Number(b === "origin") - Number(a === "origin"));
  const remote =
    ordered
      .map((name) => `${name}/${pr.headRef}`)
      .find((name) => branches.some((b) => b.isRemote && b.name === name)) ?? null;
  return { local, remote };
}

/** PR 화면이 따로 안내하는 오류. 나머지는 원래 문구를 보인다. */
export type PrErrorKind = "notFound" | "forbidden" | "rateLimited" | "noGitHubRemote" | "network" | "other";

/**
 * 백엔드 `AppError`({ type, message }) → 안내 종류. `GithubApi`는 `HTTP 404: ...`처럼 상태를 앞에 둔다.
 * `Auth`는 이 명령들에서 origin 주소로 GitHub 저장소를 못 찾았을 때만 나온다(토큰 오류는 `TokenExpired`·401).
 */
export function prErrorKind(error: unknown): PrErrorKind {
  if (typeof error !== "object" || error === null || !("type" in error)) return "other";
  const { type, message } = error as { type: unknown; message?: unknown };
  const text = typeof message === "string" ? message : "";
  if (type === "RateLimit") return "rateLimited";
  if (type === "Auth") return "noGitHubRemote";
  if (type === "Network") return "network";
  if (type === "GithubApi" && text.startsWith("HTTP 404")) return "notFound";
  if (type === "GithubApi" && text.startsWith("HTTP 403")) return "forbidden";
  return "other";
}

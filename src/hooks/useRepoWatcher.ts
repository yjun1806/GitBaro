import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { TAURI_EVENTS } from "@/api/events";
import { startRepoWatch, stopRepoWatch } from "@/api/commands";
import { useAutoSyncStore } from "@/stores/auto-sync";
import { useTauriEvent } from "./useTauriEvent";

/**
 * 감시 세대 번호. 저장소를 전환하면 이전 세대의 정리(stop)와 새 세대의 시작(start)이
 * await 없이 함께 나가는데, 두 IPC 의 도착 순서는 보장되지 않는다. 경로로 짝을 맞추면
 * 같은 저장소를 오갈 때(A → B → A) 오래된 stop 이 새 감시자를 죽인다.
 */
let watchGeneration = 0;

const GIT_DIR_DEBOUNCE_MS = 250;

/**
 * Per-repo queries that depend on HEAD, the index, refs, merge/rebase state or
 * linked worktrees. recentBranches reads the reflog, which git writes together
 * with HEAD, so a HEAD change covers it. fileDiff is here because a staged diff
 * changes with the index. stashShow is keyed by stash position, so a stash
 * pushed or dropped elsewhere changes which entry each index points at.
 * wipFiles (used by the follow panel, D4) also depends on the index — staging
 * or committing changes which files are "uncommitted" without touching the
 * working tree, and `repo:activity` deliberately ignores `.git/` internals
 * (`watcher/activity.rs` classify_activity), so this is the only signal that
 * reaches it for index/HEAD-only changes (`git add`, `git commit`, `git reset`).
 */
const GIT_DIR_QUERY_KEYS = [
  "status",
  "branches",
  "branchDivergence",
  "commitHistory",
  "unpushedCommits",
  "mergeState",
  "stashList",
  "stashShow",
  "recentBranches",
  "fileDiff",
  "wipFiles",
  // main과 갈라진 지점은 주기적으로 다시 읽지 않는다. 터미널에서 한 commit·checkout처럼 git-dir만
  // 바뀌는 변화는 이 이벤트가 유일한 신호다(repo:activity는 .git을 무시한다).
  "divergencePoint",
  // 워크스페이스 리뷰의 파일별 보기. 커밋·체크아웃·원격 추적 브랜치 변화를 따라간다. 키가
  // [key, 저장소, 워크트리]라 이 저장소의 워크트리만 다시 읽는다(어느 워크트리가 바뀌었는지는 모른다).
  "unpushedFileTouches",
] as const;

/**
 * Watches the active repository via the backend FS watcher. Working-tree
 * changes invalidate the status and open file-diff queries; git-dir changes
 * (commit, checkout, stage, merge/rebase, worktree add/remove made anywhere)
 * also refresh branches, recent branches, history, merge state, stashes,
 * worktrees and diffs. Replaces tight status polling with event-driven refresh; the query keeps a slow poll as a safety net.
 */
export function useRepoWatcher(repoPath: string | null) {
  const queryClient = useQueryClient();

  // Start/stop the backend watcher as the active repo changes.
  useEffect(() => {
    if (!repoPath) return;

    // Best-effort: if the watcher fails to start, the status query's slow poll
    // still keeps the working tree in sync.
    const token = ++watchGeneration;
    startRepoWatch(repoPath, token).catch(() => {});

    return () => {
      stopRepoWatch(token).catch(() => {
        /* best-effort teardown */
      });
    };
  }, [repoPath]);

  // Listen for debounced FS change events and refresh the affected repo's status.
  useTauriEvent(TAURI_EVENTS.fsChange, ({ repoPath: changedPath }) => {
    // 원격 자동 최신화는 최근에 파일이 바뀐 작업 트리를 자동으로 받지 않는다.
    useAutoSyncStore.getState().markActivity(changedPath, Date.now());
    queryClient.invalidateQueries({ queryKey: ["status", changedPath] });
    // 열려 있는 diff도 디스크 내용을 따라가야 한다. 이벤트는 백엔드에서 이미 디바운스돼
    // 오고, 화면에 붙은 쿼리만 다시 조회된다(나머지는 stale 표시만).
    queryClient.invalidateQueries({ queryKey: ["fileDiff", changedPath] });
    // rail/목록의 dirty·ahead/behind 인디케이터도 함께 갱신 (오프라인 계산)
    queryClient.invalidateQueries({ queryKey: ["repoSyncStatus"] });
  });

  // A commit or rebase touches the git dir many times; refetch history and
  // branches once the burst settles instead of on every step.
  const gitDirTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(gitDirTimer.current), []);

  // HEAD, index, refs, or merge/rebase state changed — e.g. a commit, `git add`
  // or checkout made in a terminal.
  useTauriEvent(TAURI_EVENTS.fsGitDirChange, ({ repoPath: changedPath }) => {
    clearTimeout(gitDirTimer.current);
    gitDirTimer.current = setTimeout(() => {
      for (const key of GIT_DIR_QUERY_KEYS) {
        if (key === "wipFiles") continue; // handled below, across every path
        queryClient.invalidateQueries({ queryKey: [key, changedPath] });
      }
      // 백엔드는 감시를 시작한 저장소 경로로만 이벤트를 보낸다 — 감시자는 다른
      // 워크트리(.git/worktrees/<name>)의 HEAD·refs 변화도 감지하지만(예: 거기서
      // 커밋), 어느 워크트리가 실제로 바뀌었는지는 알려 주지 않는다. 팔로우 패널은
      // 지금 연 워크트리가 아닌 다른 워크트리를 따라갈 수 있으므로, wipFiles는
      // changedPath로 좁히지 않고 경로를 가리지 않은 채 모두 갱신한다.
      queryClient.invalidateQueries({ queryKey: ["wipFiles"] });
      // The worktree list is keyed by the owning repository, not by the
      // linked worktree being watched, so refresh it for every path.
      queryClient.invalidateQueries({ queryKey: ["worktrees"] });
      queryClient.invalidateQueries({ queryKey: ["repoSyncStatus"] });
    }, GIT_DIR_DEBOUNCE_MS);
  });
}

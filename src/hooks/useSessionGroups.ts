import { useMemo } from "react";
import { useHookSessions, useSessionList } from "@/api/queries";
import { useSessionCommitBadges } from "@/hooks/useSessionCommitBadges";
import { groupCommitsBySession, type SessionGrouping } from "@/components/history/session-groups";
import type { CommitInfo, SessionCommitLink, SessionSummary } from "@/types";

/**
 * §4.6 — the two session sources deliberately return the same shape, so they
 * merge instead of becoming two surfaces. A hook record wins over a file record
 * for the same `sessionId`: GitBaro wrote it itself, so it does not depend on
 * an agent's session-log format staying put (V28).
 *
 * With hooks uninstalled `hookSessions` is empty and this is the file list.
 */
function unionBySessionId(
  fileSessions: readonly SessionSummary[],
  hookSessions: readonly SessionSummary[],
): SessionSummary[] {
  const byId = new Map(fileSessions.map((session) => [session.sessionId, session]));
  for (const session of hookSessions) byId.set(session.sessionId, session);
  return [...byId.values()];
}

export interface SessionGroupsResult extends SessionGrouping {
  /**
   * Sessions known for this repository, whether or not any of their commits is
   * on the loaded history page. Zero means the machine has no session logs, so
   * the caller hides the view-mode toggle entirely (§7-⑥).
   */
  sessionCount: number;
  /**
   * The winning link per commit id, `low` confidence already dropped. Exposed
   * so the flat timeline's badges and the grouping agree by construction.
   */
  linkByCommit: ReadonlyMap<string, SessionCommitLink>;
  isLoading: boolean;
}

/**
 * V30 — the loaded history page bucketed by the agent session that produced it.
 *
 * Attribution reuses `useSessionCommitBadges`, which already drops `low`
 * confidence links, so the grouping inherits §7-⑧ instead of restating it.
 */
export function useSessionGroups(
  repoPath: string | null,
  commits: readonly CommitInfo[],
): SessionGroupsResult {
  const { data: fileSessions = [], isLoading } = useSessionList(repoPath);
  const { data: hookSessions = [] } = useHookSessions(repoPath);

  const sessions = useMemo(
    () => unionBySessionId(fileSessions, hookSessions),
    [fileSessions, hookSessions],
  );

  const commitIds = useMemo(() => commits.map((commit) => commit.id), [commits]);
  const linkByCommit = useSessionCommitBadges(repoPath, commitIds);

  const grouping = useMemo(
    () => groupCommitsBySession({ sessions, linkByCommit, commits }),
    [sessions, linkByCommit, commits],
  );

  return { ...grouping, sessionCount: sessions.length, linkByCommit, isLoading };
}

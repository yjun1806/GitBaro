// Pure grouping behind the History "by session" view mode (spec V30 · §7-⑧).
//
// Kept out of the components because this is the part that can lie: putting a
// commit under a session that did not produce it is worse than showing no
// session at all, so the attribution rules get tests rather than a code review.

import { sessionDurationMs } from "@/components/session/session-signals";
import type { CommitInfo, LinkConfidence, SessionCommitLink, SessionSummary } from "@/types";

/** Sort key for the bucket of commits no session confidently claims. */
export const UNLINKED_GROUP_KEY = "__unlinked__";

export interface SessionGroup {
  /** Stable per-group key. Equals `session.filePath`. */
  key: string;
  session: SessionSummary;
  /** The session's commits, in the order they appear in the history page. */
  commits: CommitInfo[];
  /** Files the session edited — not files the commits touched. */
  fileCount: number;
  durationMs: number;
  /**
   * Weakest confidence among the links that put commits here. `medium` means
   * the header has to say the grouping is an estimate (§7-⑧).
   */
  confidence: LinkConfidence;
}

export interface SessionGrouping {
  groups: SessionGroup[];
  /**
   * Commits no `high`/`medium` link claims. Never dropped — an unattributed
   * commit still has to be reviewable.
   */
  unlinked: CommitInfo[];
}

export interface GroupCommitsBySessionInput {
  /** Sessions known for this repository, in the order the backend listed them. */
  sessions: readonly SessionSummary[];
  /**
   * The winning link per commit id, already filtered to `high`/`medium` —
   * `useSessionCommitBadges` produces exactly this map.
   */
  linkByCommit: ReadonlyMap<string, SessionCommitLink>;
  /** The loaded history page, newest first. */
  commits: readonly CommitInfo[];
}

/** `high` outranks `medium`; anything else never reaches a group. */
const CONFIDENCE_RANK: Record<LinkConfidence, number> = { high: 2, medium: 1, low: 0 };

/**
 * Buckets a history page under the agent sessions that produced it.
 *
 * Only links already accepted by `useSessionCommitBadges` group a commit, so a
 * `low`-confidence guess can never silently move a commit under a session.
 * Group order follows the first commit of each group, which keeps the list in
 * the same newest-first direction as the flat timeline.
 */
export function groupCommitsBySession({
  sessions,
  linkByCommit,
  commits,
}: GroupCommitsBySessionInput): SessionGrouping {
  const sessionById = new Map(sessions.map((session) => [session.sessionId, session]));

  const order: string[] = [];
  const commitsBySession = new Map<string, CommitInfo[]>();
  const confidenceBySession = new Map<string, LinkConfidence>();
  const unlinked: CommitInfo[] = [];

  for (const commit of commits) {
    const link = linkByCommit.get(commit.id);
    const session = link ? sessionById.get(link.sessionId) : undefined;
    if (!link || !session || CONFIDENCE_RANK[link.confidence] === 0) {
      unlinked.push(commit);
      continue;
    }

    const id = session.sessionId;
    const seen = commitsBySession.get(id);
    if (!seen) order.push(id);
    commitsBySession.set(id, seen ? [...seen, commit] : [commit]);

    // The header speaks for the whole group, so the weakest link wins.
    const known = confidenceBySession.get(id);
    const isWeaker = known && CONFIDENCE_RANK[known] < CONFIDENCE_RANK[link.confidence];
    confidenceBySession.set(id, isWeaker ? known : link.confidence);
  }

  const groups = order.map((id) => {
    const session = sessionById.get(id)!;
    return {
      key: session.filePath,
      session,
      commits: commitsBySession.get(id) ?? [],
      fileCount: session.filesEdited.length,
      durationMs: sessionDurationMs(session),
      confidence: confidenceBySession.get(id) ?? "medium",
    };
  });

  return { groups, unlinked };
}

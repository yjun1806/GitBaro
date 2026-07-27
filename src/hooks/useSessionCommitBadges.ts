import { useMemo } from "react";
import { useSessionCommitLinks } from "@/api/queries";
import { linkPresentation } from "@/components/session/session-signals";
import type { SessionCommitLink } from "@/types";

/** Correlating every loaded commit would grow without bound as history pages in. */
const MAX_CORRELATED_COMMITS = 100;

/**
 * V30 — the session (if any) that plausibly produced each commit.
 *
 * `low` confidence links are dropped here rather than in the badge: spec §7-⑧
 * treats misattribution as worse than no attribution, so a guess never reaches
 * a commit row. Where several sessions claim the same commit the strongest
 * confidence wins, never the last one seen.
 */
export function useSessionCommitBadges(
  repoPath: string | null,
  commitIds: readonly string[],
): Map<string, SessionCommitLink> {
  const oids = useMemo(
    () => commitIds.slice(0, MAX_CORRELATED_COMMITS),
    [commitIds],
  );
  const { data: links = [] } = useSessionCommitLinks(repoPath, oids);

  return useMemo(() => {
    const visible = oids.length > 0 ? new Set(oids) : null;
    const byCommit = new Map<string, SessionCommitLink>();
    // "fact" (high) is written first so no weaker link can displace it.
    for (const presentation of ["fact", "estimate"] as const) {
      for (const link of links) {
        if (linkPresentation(link.confidence) !== presentation) continue;
        for (const commitId of link.commitIds) {
          if (visible && !visible.has(commitId)) continue;
          if (!byCommit.has(commitId)) byCommit.set(commitId, link);
        }
      }
    }
    return byCommit;
  }, [links, oids]);
}

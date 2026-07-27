import { useQuery } from "@tanstack/react-query";
import { listSessionDigests } from "@/api/commands";
import type { SessionDigest } from "@/types";

/** Sessions listed in the history sidebar. The report page fetches its own detail. */
const SESSION_LIST_LIMIT = 50;

export interface SessionData {
  /**
   * Whether this repository has any readable agent session.
   *
   * **False while loading and false on error.** A panel that appears for a
   * moment and then vanishes is as much of an interruption as a permanent empty
   * state, so the gate stays shut until there is a definite answer.
   */
  hasSessions: boolean;
  isLoading: boolean;
  digests: SessionDigest[];
}

/**
 * DECISION A, in one place.
 *
 * No session log ⇒ no verification UI at all. GitBaro then behaves exactly as it
 * did before this feature existed: no empty states, no placeholder panels, no
 * "install hooks to enable" prompts. The feature is invisible unless there is
 * something real to say.
 *
 * Exactly two mount points consult this — the history session list and the
 * report page. Everything else returns `null` unconditionally.
 *
 * One query backs it (`list_session_digests`), which returns an empty list —
 * never an error — when no agent CLI has ever run here.
 */
export function useSessionData(repoPath: string | null): SessionData {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["sessionDigests", repoPath],
    queryFn: () => listSessionDigests(repoPath!, SESSION_LIST_LIMIT),
    enabled: repoPath !== null,
    staleTime: 30_000,
    retry: false,
  });

  const digests = data ?? [];

  return {
    hasSessions: !isLoading && !isError && digests.length > 0,
    isLoading,
    digests,
  };
}

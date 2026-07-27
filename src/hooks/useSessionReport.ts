import { useQuery } from "@tanstack/react-query";
import { getSessionReport } from "@/api/commands";
import type { SessionReport } from "@/types";

/**
 * One session's whole report in one round-trip.
 *
 * The backend assembles all five sections inside a single blocking task and
 * resolves with `null` — never an error — when the log holds nothing
 * recognisable. So this never retries: a second parse of an unparseable file
 * costs seconds and returns the same nothing.
 */
export function useSessionReport(repoPath: string | null, sessionPath: string | null) {
  return useQuery<SessionReport | null>({
    queryKey: ["sessionReport", repoPath, sessionPath],
    queryFn: () => getSessionReport(repoPath!, sessionPath!),
    enabled: repoPath !== null && sessionPath !== null,
    staleTime: 30_000,
    retry: false,
  });
}

import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getCommitReviewStates,
  markCommitReviewed,
  unmarkCommitReviewed,
} from "@/api/commands";
import { sessionReviewState, type SessionReviewState } from "./report-model";

export interface SessionReviewHandle {
  state: SessionReviewState;
  /** How many of the session's commits carry a mark. */
  reviewedCount: number;
  totalCount: number;
  isPending: boolean;
  markReviewed: () => void;
  unmarkReviewed: () => void;
}

/**
 * Review anchored to the session rather than to a file.
 *
 * "I have read this file's diff" was the wrong unit: a reader finishes a
 * *session*, and a per-file toggle asked them to re-derive the session boundary
 * by hand. The mark itself is still stored per commit — commits are the only
 * durable id here — so this reuses the existing review commands and every
 * attributed commit is marked together.
 *
 * With no attributed commits there is nothing durable to mark, and the caller
 * renders no control at all.
 */
export function useSessionReview(
  repoPath: string,
  commitIds: string[],
): SessionReviewHandle {
  const queryClient = useQueryClient();
  const enabled = commitIds.length > 0;

  const { data: states = [] } = useQuery({
    queryKey: ["commitReviewStates", repoPath, commitIds],
    queryFn: () => getCommitReviewStates(repoPath, commitIds),
    enabled,
    staleTime: 0,
  });

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["commitReviewStates"] }),
      queryClient.invalidateQueries({ queryKey: ["reviewQueue"] }),
    ]);

  const mark = useMutation({
    mutationFn: () => Promise.all(commitIds.map((id) => markCommitReviewed(repoPath, id))),
    onSuccess: invalidate,
  });

  const unmark = useMutation({
    mutationFn: () => Promise.all(commitIds.map((id) => unmarkCommitReviewed(repoPath, id))),
    onSuccess: invalidate,
  });

  const markReviewed = useCallback(() => mark.mutate(), [mark]);
  const unmarkReviewed = useCallback(() => unmark.mutate(), [unmark]);

  const reviewedIds = new Set(
    states.filter((state) => state.status === "reviewed").map((state) => state.commitId),
  );

  return {
    state: sessionReviewState(commitIds, states),
    reviewedCount: commitIds.filter((id) => reviewedIds.has(id)).length,
    totalCount: commitIds.length,
    isPending: mark.isPending || unmark.isPending,
    markReviewed,
    unmarkReviewed,
  };
}

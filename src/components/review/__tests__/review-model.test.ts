import { describe, expect, it } from "vitest";
import {
  computeReviewProgress,
  deriveReviewQueue,
  msToUnixSeconds,
  requiresDangerConfirmation,
} from "@/components/review/review-model";
import type {
  CommitInfo,
  CommitReviewState,
  CommitVerificationSummary,
  FileReviewEntry,
  PushGateSummary,
  ReviewStatus,
} from "@/types";

function makeCommit(id: string, timestamp = 1_700_000_000): CommitInfo {
  return {
    id,
    shortId: id.slice(0, 7),
    message: `${id} message`,
    summary: `${id} summary`,
    author: { name: "Author", email: "author@example.com" },
    committer: { name: "Author", email: "author@example.com" },
    timestamp,
    parentIds: [],
    refs: [],
  };
}

function makeReviewState(commitId: string, status: ReviewStatus): CommitReviewState {
  return { commitId, status, reviewedAt: null, reviewer: null };
}

function makeSummary(
  commitId: string,
  overrides: Partial<CommitVerificationSummary> = {},
): CommitVerificationSummary {
  return {
    commitId,
    maxSeverity: null,
    dangerCount: 0,
    warnCount: 0,
    infoCount: 0,
    uncheckedCount: 0,
    ...overrides,
  };
}

function makeFileEntry(path: string, status: ReviewStatus): FileReviewEntry {
  return { path, status, reviewedAt: null, reviewer: null };
}

function makePushGate(overrides: Partial<PushGateSummary> = {}): PushGateSummary {
  return {
    commits: [],
    unreviewedCount: 0,
    dangerCount: 0,
    warnCount: 0,
    tangledCount: 0,
    ...overrides,
  };
}

describe("deriveReviewQueue", () => {
  it("keeps only queued commits and orders them like the history page", () => {
    const commits = [makeCommit("c3"), makeCommit("c2"), makeCommit("c1")];
    const { rows } = deriveReviewQueue({
      // Backend order is deliberately different to prove ordering follows commits.
      queueIds: ["c1", "c3"],
      commits,
      reviewStates: [],
      summaries: [],
    });

    expect(rows.map((r) => r.commit.id)).toEqual(["c3", "c1"]);
  });

  it("defaults a queued commit with no review state to unreviewed", () => {
    const { rows } = deriveReviewQueue({
      queueIds: ["c1"],
      commits: [makeCommit("c1")],
      reviewStates: [],
      summaries: [],
    });

    expect(rows[0].status).toBe("unreviewed");
  });

  it("reflects a review state for a retained commit that already left the queue", () => {
    const { rows } = deriveReviewQueue({
      queueIds: [],
      retainedIds: ["c1"],
      commits: [makeCommit("c1")],
      reviewStates: [makeReviewState("c1", "reviewed")],
      summaries: [],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("reviewed");
  });

  it("does not duplicate a commit present in both the queue and the retained set", () => {
    const { rows, unresolvedCount } = deriveReviewQueue({
      queueIds: ["c1"],
      retainedIds: ["c1"],
      commits: [makeCommit("c1")],
      reviewStates: [],
      summaries: [],
    });

    expect(rows).toHaveLength(1);
    expect(unresolvedCount).toBe(0);
  });

  it("counts queued commits missing from the loaded history as unresolved", () => {
    const { rows, unresolvedCount } = deriveReviewQueue({
      queueIds: ["c1", "c2", "c3"],
      commits: [makeCommit("c1")],
      reviewStates: [],
      summaries: [],
    });

    expect(rows.map((r) => r.commit.id)).toEqual(["c1"]);
    expect(unresolvedCount).toBe(2);
  });

  it("attaches the verification summary when one exists and null when it does not", () => {
    const { rows } = deriveReviewQueue({
      queueIds: ["c2", "c1"],
      commits: [makeCommit("c2"), makeCommit("c1")],
      reviewStates: [],
      summaries: [makeSummary("c2", { dangerCount: 1, maxSeverity: "danger" })],
    });

    expect(rows[0].verification?.dangerCount).toBe(1);
    // Missing summary is an absent answer, never an implied clean result.
    expect(rows[1].verification).toBeNull();
  });

  it("ignores duplicate commits in the history page", () => {
    const { rows } = deriveReviewQueue({
      queueIds: ["c1"],
      commits: [makeCommit("c1"), makeCommit("c1")],
      reviewStates: [],
      summaries: [],
    });

    expect(rows).toHaveLength(1);
  });

  it("returns an empty derivation for an empty queue", () => {
    const { rows, unresolvedCount } = deriveReviewQueue({
      queueIds: [],
      commits: [makeCommit("c1")],
      reviewStates: [],
      summaries: [],
    });

    expect(rows).toEqual([]);
    expect(unresolvedCount).toBe(0);
  });
});

describe("computeReviewProgress", () => {
  it("counts reviewed files against the current diff", () => {
    const counts = computeReviewProgress(
      ["a.ts", "b.ts", "c.ts"],
      [makeFileEntry("a.ts", "reviewed"), makeFileEntry("b.ts", "reviewed")],
    );

    expect(counts).toEqual({ total: 3, reviewed: 2, stale: 0, unreviewed: 1 });
  });

  it("does not count a stale file as reviewed", () => {
    const counts = computeReviewProgress(
      ["a.ts", "b.ts"],
      [makeFileEntry("a.ts", "reviewed"), makeFileEntry("b.ts", "stale")],
    );

    expect(counts).toEqual({ total: 2, reviewed: 1, stale: 1, unreviewed: 0 });
  });

  it("ignores marks for files that are no longer in the diff", () => {
    const counts = computeReviewProgress(
      ["a.ts"],
      [makeFileEntry("a.ts", "reviewed"), makeFileEntry("gone.ts", "reviewed")],
    );

    expect(counts).toEqual({ total: 1, reviewed: 1, stale: 0, unreviewed: 0 });
  });

  it("deduplicates repeated paths so the denominator stays honest", () => {
    const counts = computeReviewProgress(
      ["a.ts", "a.ts", "b.ts"],
      [makeFileEntry("a.ts", "reviewed")],
    );

    expect(counts).toEqual({ total: 2, reviewed: 1, stale: 0, unreviewed: 1 });
  });

  it("treats a missing entry as unreviewed", () => {
    const counts = computeReviewProgress(["a.ts", "b.ts"], []);

    expect(counts).toEqual({ total: 2, reviewed: 0, stale: 0, unreviewed: 2 });
  });

  it("reports zero total for an empty diff", () => {
    expect(computeReviewProgress([], [])).toEqual({
      total: 0,
      reviewed: 0,
      stale: 0,
      unreviewed: 0,
    });
  });
});

describe("requiresDangerConfirmation", () => {
  it("asks only when a danger finding exists", () => {
    expect(requiresDangerConfirmation(makePushGate({ dangerCount: 1 }))).toBe(true);
  });

  it("does not ask for warnings alone", () => {
    expect(requiresDangerConfirmation(makePushGate({ warnCount: 5 }))).toBe(false);
  });

  it("does not ask for unreviewed commits alone", () => {
    expect(requiresDangerConfirmation(makePushGate({ unreviewedCount: 9 }))).toBe(false);
  });

  it("does not ask when the summary is unavailable", () => {
    expect(requiresDangerConfirmation(null)).toBe(false);
    expect(requiresDangerConfirmation(undefined)).toBe(false);
  });
});

describe("msToUnixSeconds", () => {
  it("converts verify millisecond timestamps to the seconds formatRelativeTime expects", () => {
    expect(msToUnixSeconds(1_700_000_000_000)).toBe(1_700_000_000);
  });

  it("floors sub-second remainders", () => {
    expect(msToUnixSeconds(1_700_000_000_999)).toBe(1_700_000_000);
  });
});

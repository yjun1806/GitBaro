import { describe, expect, it } from "vitest";
import { DIGEST_ROWS, rankDigestRows } from "@/components/history/risk-digest-model";
import type { ReviewQueueRow } from "@/components/review/review-model";
import type {
  CommitInfo,
  CommitVerificationSummary,
  ReviewStatus,
  Severity,
} from "@/types";

function makeCommit(id: string): CommitInfo {
  return {
    id,
    shortId: id.slice(0, 7),
    message: `${id} message`,
    summary: `${id} summary`,
    author: { name: "Author", email: "author@example.com" },
    committer: { name: "Author", email: "author@example.com" },
    timestamp: 1_700_000_000,
    parentIds: [],
    refs: [],
  };
}

function makeRow(
  id: string,
  verification: Partial<CommitVerificationSummary> | null,
  status: ReviewStatus = "unreviewed",
): ReviewQueueRow {
  return {
    commit: makeCommit(id),
    status,
    verification: verification && {
      commitId: id,
      maxSeverity: null,
      dangerCount: 0,
      warnCount: 0,
      infoCount: 0,
      uncheckedCount: 22,
      ...verification,
    },
  };
}

function sev(maxSeverity: Severity, counts: Partial<CommitVerificationSummary> = {}) {
  return { maxSeverity, ...counts };
}

describe("rankDigestRows", () => {
  it("puts one danger ahead of any number of infos (P6)", () => {
    const rows = [
      makeRow("info", sev("info", { infoCount: 100 })),
      makeRow("danger", sev("danger", { dangerCount: 1 })),
    ];

    expect(rankDigestRows(rows).rows.map((r) => r.commit.id)).toEqual(["danger", "info"]);
  });

  it("breaks severity ties by count, then by history position", () => {
    const rows = [
      makeRow("older", sev("warn", { warnCount: 2 })),
      makeRow("newest", sev("warn", { warnCount: 2 })),
      makeRow("loudest", sev("warn", { warnCount: 9 })),
    ];

    // "older" precedes "newest" in the input, which is history order.
    expect(rankDigestRows(rows).rows.map((r) => r.commit.id)).toEqual([
      "loudest",
      "older",
      "newest",
    ]);
  });

  it("ranks a commit with no summary below every severity but still lists it", () => {
    const rows = [makeRow("unknown", null), makeRow("info", sev("info", { infoCount: 1 }))];

    expect(rankDigestRows(rows).rows.map((r) => r.commit.id)).toEqual(["info", "unknown"]);
  });

  it("drops reviewed rows so they do not hold a slot", () => {
    const rows = [
      makeRow("read", sev("danger", { dangerCount: 3 }), "reviewed"),
      makeRow("unread", sev("info", { infoCount: 1 })),
    ];

    const ranking = rankDigestRows(rows);
    expect(ranking.rows.map((r) => r.commit.id)).toEqual(["unread"]);
    expect(ranking.candidateCount).toBe(1);
  });

  it("keeps stale rows, which are unreviewed by definition", () => {
    const rows = [makeRow("stale", sev("warn", { warnCount: 1 }), "stale")];

    expect(rankDigestRows(rows).rows.map((r) => r.commit.id)).toEqual(["stale"]);
  });

  it("truncates to the limit and says so", () => {
    const rows = Array.from({ length: DIGEST_ROWS + 3 }, (_, i) =>
      makeRow(`c${i}`, sev("warn", { warnCount: 1 })),
    );

    const ranking = rankDigestRows(rows);
    expect(ranking.rows).toHaveLength(DIGEST_ROWS);
    expect(ranking.candidateCount).toBe(DIGEST_ROWS + 3);
    expect(ranking.truncated).toBe(true);
  });

  it("is stable: the same input always ranks the same way", () => {
    const rows = [
      makeRow("a", sev("warn", { warnCount: 1 })),
      makeRow("b", sev("warn", { warnCount: 1 })),
      makeRow("c", sev("warn", { warnCount: 1 })),
    ];

    const first = rankDigestRows(rows).rows.map((r) => r.commit.id);
    const second = rankDigestRows(rows).rows.map((r) => r.commit.id);
    expect(first).toEqual(second);
  });

  it("does not mutate the input order", () => {
    const rows = [
      makeRow("low", sev("info", { infoCount: 1 })),
      makeRow("high", sev("danger", { dangerCount: 1 })),
    ];

    rankDigestRows(rows);
    expect(rows.map((r) => r.commit.id)).toEqual(["low", "high"]);
  });
});

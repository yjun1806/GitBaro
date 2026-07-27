import { describe, expect, it } from "vitest";
import type {
  BlastRadiusEntry,
  CommitReviewState,
  DriftSection,
  OrdealEvent,
  OrdealKind,
  PromptMention,
  TouchedFile,
  Unavailable,
} from "@/types";
import {
  buildOrdealTimeline,
  churnEmphasis,
  collapseOrdealRuns,
  confidenceTone,
  driftSentence,
  durationParts,
  elidedCallerCount,
  isDriftRenderable,
  isRenderableSentence,
  knownBasis,
  msToUnixSeconds,
  orderOrdealEvents,
  rankTouchedFiles,
  sectionState,
  sessionReviewState,
  uncommittedFiles,
  untouchedCallSites,
} from "../report-model";

// ── fixtures ─────────────────────────────────────────────────────────────────

function touched(path: string, editCount: number, extra: Partial<TouchedFile> = {}): TouchedFile {
  return {
    path,
    editCount,
    wasReadFirst: true,
    bySubagent: false,
    viaBash: false,
    afterCompaction: false,
    firstEditAt: 0,
    lastEditAt: 0,
    addedLines: null,
    removedLines: null,
    inCommit: true,
    isTest: false,
    provenance: "sessionLog",
    ...extra,
  };
}

function ordeal(at: number, kind: OrdealKind, evidence: string): OrdealEvent {
  return {
    at,
    kind,
    evidence,
    detail: null,
    severity: kind === "testFailed" ? "warn" : "info",
    provenance: "sessionLog",
  };
}

function mention(raw: string, path: string | null): PromptMention {
  return {
    raw,
    extractor: "backtick",
    resolved: path === null ? null : { path, kind: "file" },
    promptOrdinal: 0,
  };
}

function drift(overrides: Partial<DriftSection> = {}): DriftSection {
  return {
    unavailable: null,
    mentions: [],
    inScopePaths: [],
    driftedPaths: [],
    driftedTotal: 0,
    changedTotal: 0,
    verdict: "noAnchor",
    confidence: "medium",
    basis: "attributedCommitRange",
    ...overrides,
  };
}

function unavailable(reason: Unavailable["reason"]): Unavailable {
  return { reason, detail: null };
}

// ── time ─────────────────────────────────────────────────────────────────────

describe("msToUnixSeconds", () => {
  it("floors milliseconds so a sub-second value never rounds into the future", () => {
    expect(msToUnixSeconds(1_700_000_999)).toBe(1_700_000);
  });
});

describe("durationParts", () => {
  it("collapses anything under a minute into one unit", () => {
    expect(durationParts(59_000)).toEqual({ unit: "underMinute", value: 0 });
  });

  it("reports whole minutes below an hour and whole hours above it", () => {
    expect(durationParts(47 * 60_000)).toEqual({ unit: "minutes", value: 47 });
    expect(durationParts(150 * 60_000)).toEqual({ unit: "hours", value: 2 });
  });

  it("clamps clock skew instead of rendering a negative duration", () => {
    expect(durationParts(-5_000)).toEqual({ unit: "underMinute", value: 0 });
  });
});

// ── section availability ─────────────────────────────────────────────────────

describe("sectionState", () => {
  it("renders the body when there is content and no reason it is missing", () => {
    expect(sectionState(null, true)).toBe("ready");
  });

  it("hides an available-but-empty section rather than drawing an empty box", () => {
    expect(sectionState(null, false)).toBe("hidden");
  });

  it("explains the reasons that come with an action or change what to trust", () => {
    expect(sectionState(unavailable("noSymbolIndex"), false)).toBe("explain");
    expect(sectionState(unavailable("partialSymbolIndex"), false)).toBe("explain");
    expect(sectionState(unavailable("noCommitAttribution"), false)).toBe("explain");
    expect(sectionState(unavailable("unsupportedAgent"), false)).toBe("explain");
    expect(sectionState(unavailable("parseBudget"), false)).toBe("explain");
    expect(sectionState(unavailable("noPrompt"), false)).toBe("explain");
  });

  it("stays silent when the section simply has no question to answer here", () => {
    expect(sectionState(unavailable("notApplicable"), false)).toBe("hidden");
    expect(sectionState(unavailable("noResolvableAnchor"), false)).toBe("hidden");
  });

  it("never renders a body that the backend contradicted with a reason", () => {
    expect(sectionState(unavailable("noSymbolIndex"), true)).toBe("explain");
  });
});

// ── churn ranking ────────────────────────────────────────────────────────────

describe("rankTouchedFiles", () => {
  it("puts the most-rewritten file first — that is where the agent struggled", () => {
    const ranked = rankTouchedFiles([
      touched("src/a.ts", 1),
      touched("src/b.ts", 7),
      touched("src/c.ts", 3),
    ]);
    expect(ranked.map((file) => file.path)).toEqual(["src/b.ts", "src/c.ts", "src/a.ts"]);
  });

  it("breaks ties by path so the order does not shuffle between renders", () => {
    const ranked = rankTouchedFiles([touched("src/z.ts", 2), touched("src/a.ts", 2)]);
    expect(ranked.map((file) => file.path)).toEqual(["src/a.ts", "src/z.ts"]);
  });

  it("does not mutate the caller's array", () => {
    const input = [touched("src/a.ts", 1), touched("src/b.ts", 5)];
    rankTouchedFiles(input);
    expect(input.map((file) => file.path)).toEqual(["src/a.ts", "src/b.ts"]);
  });
});

describe("churnEmphasis", () => {
  it("says nothing about a file edited once — a badge on every row is noise", () => {
    expect(churnEmphasis(1)).toBe("none");
    expect(churnEmphasis(0)).toBe("none");
  });

  it("notes a re-edit and raises its voice once churn is the story", () => {
    expect(churnEmphasis(2)).toBe("note");
    expect(churnEmphasis(3)).toBe("note");
    expect(churnEmphasis(4)).toBe("strong");
    expect(churnEmphasis(7)).toBe("strong");
  });
});

describe("uncommittedFiles", () => {
  it("keeps only what no attributed commit contains", () => {
    const files = [touched("src/a.ts", 1), touched("src/b.ts", 1, { inCommit: false })];
    expect(uncommittedFiles(files).map((file) => file.path)).toEqual(["src/b.ts"]);
  });
});

// ── the ordeal sequence ──────────────────────────────────────────────────────

describe("orderOrdealEvents", () => {
  it("orders by time — the sequence is the finding", () => {
    const ordered = orderOrdealEvents([
      ordeal(300, "testFailed", "pnpm test"),
      ordeal(100, "testFailed", "pnpm test"),
      ordeal(200, "shellMutation", "sed -i s/x/y/ a.ts"),
    ]);
    expect(ordered.map((event) => event.at)).toEqual([100, 200, 300]);
  });

  it("keeps the backend's order for identical timestamps", () => {
    const ordered = orderOrdealEvents([
      ordeal(100, "testFailed", "first"),
      ordeal(100, "hookBypass", "second"),
    ]);
    expect(ordered.map((event) => event.evidence)).toEqual(["first", "second"]);
  });
});

describe("collapseOrdealRuns", () => {
  it("folds adjacent test failures into one beat that carries the count", () => {
    const beats = collapseOrdealRuns([
      ordeal(1, "testFailed", "pnpm test src/a"),
      ordeal(2, "testFailed", "pnpm test src/b"),
      ordeal(3, "testFailed", "pnpm test src/c"),
    ]);
    expect(beats).toHaveLength(1);
    expect(beats[0].repeats).toBe(3);
    expect(beats[0].lastAt).toBe(3);
  });

  it("never folds across a different kind, so the beat boundary survives", () => {
    const beats = buildOrdealTimeline([
      ordeal(1, "testFailed", "pnpm test"),
      ordeal(2, "testFailed", "pnpm test"),
      ordeal(3, "shellMutation", "src/a.test.ts"),
      ordeal(4, "testFailed", "pnpm test"),
    ]);
    expect(beats.map((beat) => [beat.event.kind, beat.repeats])).toEqual([
      ["testFailed", 2],
      ["shellMutation", 1],
      ["testFailed", 1],
    ]);
  });

  it("keeps distinct bypass commands apart — each one is its own evidence", () => {
    const beats = collapseOrdealRuns([
      ordeal(1, "hookBypass", "git commit --no-verify"),
      ordeal(2, "hookBypass", "git push -f"),
    ]);
    expect(beats).toHaveLength(2);
  });

  it("folds an identical command repeated back to back", () => {
    const beats = collapseOrdealRuns([
      ordeal(1, "hookBypass", "git commit --no-verify"),
      ordeal(2, "hookBypass", "git commit --no-verify"),
    ]);
    expect(beats).toHaveLength(1);
    expect(beats[0].repeats).toBe(2);
  });

  it("returns nothing for no events", () => {
    expect(collapseOrdealRuns([])).toEqual([]);
  });
});

// ── impact ───────────────────────────────────────────────────────────────────

function entry(overrides: Partial<BlastRadiusEntry> = {}): BlastRadiusEntry {
  return {
    symbol: "resolveToken",
    file: "src/auth.ts",
    kind: "function",
    signatureChanged: true,
    callers: [
      { file: "src/a.ts", line: 10, symbol: "load", touchedInDiff: true },
      { file: "src/b.ts", line: 20, symbol: null, touchedInDiff: false },
    ],
    callerCount: 2,
    untouchedCallerCount: 1,
    resolution: { type: "nameUnique" },
    ...overrides,
  };
}

describe("untouchedCallSites", () => {
  it("names only the call sites this session did not update", () => {
    expect(untouchedCallSites(entry()).map((site) => site.file)).toEqual(["src/b.ts"]);
  });
});

describe("elidedCallerCount", () => {
  it("is zero when the visible list is complete", () => {
    expect(elidedCallerCount(entry())).toBe(0);
  });

  it("reports how many the backend's cap dropped", () => {
    expect(elidedCallerCount(entry({ untouchedCallerCount: 60 }))).toBe(59);
  });
});

// ── confidence ───────────────────────────────────────────────────────────────

describe("confidenceTone", () => {
  it("states high plainly, hedges medium, and never shows low", () => {
    expect(confidenceTone("high")).toBe("fact");
    expect(confidenceTone("medium")).toBe("estimate");
    expect(confidenceTone("low")).toBe("hidden");
  });
});

describe("knownBasis", () => {
  it("keeps every token the backend contract defines", () => {
    const tokens = [
      "cwd",
      "branch",
      "timeWindow",
      "fileOverlap",
      "mtime",
      "author",
      "reflog",
      "siblingWorktree",
    ];
    expect(knownBasis(tokens)).toEqual(tokens);
  });

  it("drops anything it cannot translate rather than printing a raw token", () => {
    expect(knownBasis(["branch", "someFutureSignal"])).toEqual(["branch"]);
  });
});

// ── drift wording ────────────────────────────────────────────────────────────

describe("isRenderableSentence", () => {
  it("accepts a sentence carrying both a count and a concrete path", () => {
    expect(isRenderableSentence("6개 변경 중 2개가 프롬프트에 없던 곳이다 — src/api/commands.ts 외.")).toBe(
      true,
    );
  });

  it("rejects a sentence with no number", () => {
    expect(isRenderableSentence("프롬프트가 지목한 곳 안에서만 바뀌었다 — src/a.ts.")).toBe(false);
  });

  it("rejects a sentence that names no path", () => {
    expect(isRenderableSentence("6개 변경 중 2개가 프롬프트에 없던 곳이다.")).toBe(false);
  });

  it("rejects judgement words — the page describes, it does not accuse", () => {
    expect(isRenderableSentence("src/a.ts 1곳을 잘못 고쳤다.")).toBe(false);
    expect(isRenderableSentence("1 path in src/a.ts should not have changed.")).toBe(false);
    expect(isRenderableSentence("1 violation in src/a.ts")).toBe(false);
  });
});

describe("driftSentence", () => {
  it("gives withinScope both a count and a path so the sentence can be rendered", () => {
    const sentence = driftSentence(
      drift({
        verdict: "withinScope",
        mentions: [mention("`src/auth.ts`", "src/auth.ts")],
        inScopePaths: ["src/auth.ts"],
        changedTotal: 1,
      }),
    );
    expect(sentence).toEqual({
      key: "withinScope",
      params: { anchors: 1, first: "src/auth.ts" },
    });
  });

  it("gives partialDrift the drifted count, the total, and the first drifted path", () => {
    const sentence = driftSentence(
      drift({
        verdict: "partialDrift",
        mentions: [mention("`src/auth.ts`", "src/auth.ts")],
        driftedPaths: [{ path: "src/ui/Toolbar.tsx", editCount: 3, addedLines: 10, removedLines: 2, isTest: false }],
        driftedTotal: 2,
        changedTotal: 6,
      }),
    );
    expect(sentence).toEqual({
      key: "partial",
      params: { drifted: 2, total: 6, first: "src/ui/Toolbar.tsx" },
    });
  });

  it("gives fullDrift a count alongside the anchor list", () => {
    const sentence = driftSentence(
      drift({
        verdict: "fullDrift",
        mentions: [mention("`src/auth.ts`", "src/auth.ts"), mention("`src/api/`", "src/api/")],
        changedTotal: 4,
      }),
    );
    expect(sentence).toEqual({
      key: "full",
      params: { anchors: 2, anchorList: "src/auth.ts, src/api/" },
    });
  });

  it("returns nothing when there is no concrete path to name", () => {
    expect(driftSentence(drift({ verdict: "noAnchor" }))).toBeNull();
    expect(driftSentence(drift({ verdict: "fullDrift", mentions: [mention("login", null)] }))).toBeNull();
    expect(driftSentence(drift({ verdict: "partialDrift", driftedTotal: 3 }))).toBeNull();
  });
});

describe("isDriftRenderable", () => {
  it("stays silent when the prompt named no scope (G1)", () => {
    expect(isDriftRenderable(drift({ verdict: "noAnchor" }))).toBe(false);
    expect(
      isDriftRenderable(drift({ unavailable: unavailable("noResolvableAnchor") })),
    ).toBe(false);
  });

  it("stays silent when every mention failed to resolve", () => {
    expect(
      isDriftRenderable(
        drift({ verdict: "partialDrift", mentions: [mention("login", null)] }),
      ),
    ).toBe(false);
  });

  it("renders once at least one mention resolved against the repository", () => {
    expect(
      isDriftRenderable(
        drift({ verdict: "partialDrift", mentions: [mention("`src/a.ts`", "src/a.ts")] }),
      ),
    ).toBe(true);
  });
});

// ── session-anchored review ──────────────────────────────────────────────────

describe("sessionReviewState", () => {
  const reviewed = (commitId: string): CommitReviewState => ({
    commitId,
    status: "reviewed",
    reviewedAt: 1,
    reviewer: "me",
  });

  it("is unreviewed when nothing is marked", () => {
    expect(sessionReviewState(["a", "b"], [])).toBe("unreviewed");
  });

  it("is reviewed only once every attributed commit carries a mark", () => {
    expect(sessionReviewState(["a", "b"], [reviewed("a"), reviewed("b")])).toBe("reviewed");
  });

  it("is partial while some commits are still unmarked", () => {
    expect(sessionReviewState(["a", "b"], [reviewed("a")])).toBe("partial");
  });

  it("ignores marks on commits outside this session", () => {
    expect(sessionReviewState(["a"], [reviewed("a"), reviewed("z")])).toBe("reviewed");
  });

  it("never claims reviewed when there is nothing to anchor a mark to", () => {
    expect(sessionReviewState([], [reviewed("a")])).toBe("unreviewed");
  });
});

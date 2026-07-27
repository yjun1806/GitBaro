// Pure derivations behind the session report page.
//
// These live outside the components because they are the parts that can quietly
// lie: a section that renders an empty box, a timeline whose order is wrong, a
// churn list that buries the file the agent fought with, a guess printed as a
// fact. Each one gets a test.
//
// Nothing here formats a sentence. The backend sends verdicts and counts; the
// components render i18n keys (report contract §4.7).

import type {
  BlastRadiusEntry,
  CallSite,
  CommitReviewState,
  DriftSection,
  LinkConfidence,
  OrdealEvent,
  ReportCommit,
  TouchedFile,
  Unavailable,
  UnavailableReason,
} from "@/types";

// ── Time ─────────────────────────────────────────────────────────────────────

/**
 * Every timestamp in this subsystem is epoch **milliseconds**, but
 * `formatRelativeTime()` takes epoch **seconds**. Every crossing goes here.
 */
export function msToUnixSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

export type DurationUnit = "underMinute" | "minutes" | "hours";

export interface DurationParts {
  unit: DurationUnit;
  value: number;
}

/** Splits a duration into unit + value so the caller picks the i18n key. */
export function durationParts(durationMs: number): DurationParts {
  const minutes = Math.floor(Math.max(0, durationMs) / 60_000);
  if (minutes < 1) return { unit: "underMinute", value: 0 };
  if (minutes < 60) return { unit: "minutes", value: minutes };
  return { unit: "hours", value: Math.floor(minutes / 60) };
}

// ── Section availability ─────────────────────────────────────────────────────

/**
 * - `ready`   — render the body.
 * - `explain` — render one sentence saying what could not be checked, and an
 *               action when there is one. Never an empty box.
 * - `hidden`  — render nothing at all. Silence is the correct answer when the
 *               section has no question to answer here.
 */
export type SectionState = "ready" | "explain" | "hidden";

/**
 * Reasons worth a sentence: each one changes what the reader does next (build
 * the index, distrust the commit half, use a different agent). The two omitted
 * reasons do not.
 *
 * - `notApplicable`      — nothing changed that this section is about.
 * - `noResolvableAnchor` — the prompt named no scope (V26 G1). Saying "we could
 *                          not check drift" on every prose prompt is the nag
 *                          DECISION A exists to prevent.
 */
const EXPLAINED_REASONS: readonly UnavailableReason[] = [
  "noPrompt",
  "noCommitAttribution",
  "noSymbolIndex",
  "partialSymbolIndex",
  "unsupportedAgent",
  "parseBudget",
];

export function sectionState(
  unavailable: Unavailable | null | undefined,
  hasContent: boolean,
): SectionState {
  if (unavailable) {
    return EXPLAINED_REASONS.includes(unavailable.reason) ? "explain" : "hidden";
  }
  return hasContent ? "ready" : "hidden";
}

// ── § 무엇을 했나 — churn ranking ────────────────────────────────────────────

/**
 * Most-edited first, then path. A file edited seven times is where the agent
 * struggled; it is the first thing the reader should open, so it is the first
 * row — regardless of how the backend happened to order the list.
 */
export function rankTouchedFiles(files: readonly TouchedFile[]): TouchedFile[] {
  return [...files].sort((a, b) => {
    const byChurn = b.editCount - a.editCount;
    return byChurn !== 0 ? byChurn : a.path.localeCompare(b.path);
  });
}

/**
 * How loudly to state the edit count. A single edit is the normal case and gets
 * no badge at all — a badge on every row is noise, not a signal.
 */
export type ChurnEmphasis = "none" | "note" | "strong";

/** Re-edits start mattering at 2 and start being the story at 4. */
export const CHURN_STRONG_THRESHOLD = 4;

export function churnEmphasis(editCount: number): ChurnEmphasis {
  if (editCount >= CHURN_STRONG_THRESHOLD) return "strong";
  if (editCount >= 2) return "note";
  return "none";
}

/** Paths the session edited that no attributed commit contains. */
export function uncommittedFiles(files: readonly TouchedFile[]): TouchedFile[] {
  return files.filter((file) => !file.inCommit);
}

export function commitIdsOf(commits: readonly ReportCommit[]): string[] {
  return commits.map((commit) => commit.commitId);
}

// ── § 무엇을 겪었나 — the sequence ───────────────────────────────────────────

/**
 * One beat of the ordeal. `repeats > 1` means the same thing happened that many
 * times in a row — "failed 3 times" is one beat of the story, not three rows.
 */
export interface OrdealBeat {
  event: OrdealEvent;
  repeats: number;
  /** Timestamp of the last event folded into this beat. */
  lastAt: number;
}

/** Kinds where the *count* is the signal, so adjacent ones fold even if the command differs. */
const COUNTABLE_KINDS: readonly OrdealEvent["kind"][] = ["testFailed", "testPassed"];

/**
 * Ascending by time, ties keeping the backend's order.
 *
 * The order **is** the finding here ("failed three times, then edited the test
 * file"), so this sort must be stable — `Array.prototype.sort` is, per spec.
 */
export function orderOrdealEvents(events: readonly OrdealEvent[]): OrdealEvent[] {
  return [...events].sort((a, b) => a.at - b.at);
}

/**
 * Folds adjacent repetitions into beats. Only *adjacent* events fold, so a beat
 * boundary always survives — the file edit between failure #2 and failure #3
 * can never be collapsed away.
 */
export function collapseOrdealRuns(events: readonly OrdealEvent[]): OrdealBeat[] {
  const beats: OrdealBeat[] = [];
  for (const event of events) {
    const previous = beats[beats.length - 1];
    const foldable =
      previous !== undefined &&
      previous.event.kind === event.kind &&
      (COUNTABLE_KINDS.includes(event.kind) || previous.event.evidence === event.evidence);

    if (foldable) {
      beats[beats.length - 1] = {
        event: previous.event,
        repeats: previous.repeats + 1,
        lastAt: event.at,
      };
    } else {
      beats.push({ event, repeats: 1, lastAt: event.at });
    }
  }
  return beats;
}

/** Order, then fold. The two steps stay separate so each can be tested alone. */
export function buildOrdealTimeline(events: readonly OrdealEvent[]): OrdealBeat[] {
  return collapseOrdealRuns(orderOrdealEvents(events));
}

// ── § 무엇이 영향받나 ────────────────────────────────────────────────────────

/**
 * The call sites this session did **not** update. This list is the actionable
 * part of the section — an entry whose callers were all touched has nothing to
 * say and the backend already dropped it.
 */
export function untouchedCallSites(entry: BlastRadiusEntry): CallSite[] {
  return entry.callers.filter((site) => !site.touchedInDiff);
}

/**
 * `callers` is capped by the backend, so the visible list can be shorter than
 * `untouchedCallerCount`. This is how many were elided.
 */
export function elidedCallerCount(entry: BlastRadiusEntry): number {
  return Math.max(0, entry.untouchedCallerCount - untouchedCallSites(entry).length);
}

// ── Confidence ───────────────────────────────────────────────────────────────

/**
 * - `fact`     — state it plainly.
 * - `estimate` — show it behind an `추정` chip with the basis spelled out.
 * - `hidden`   — never rendered; the backend does not send `low` links at all.
 */
export type ConfidenceTone = "fact" | "estimate" | "hidden";

const TONE_BY_CONFIDENCE: Record<LinkConfidence, ConfidenceTone> = {
  high: "fact",
  medium: "estimate",
  low: "hidden",
};

export function confidenceTone(confidence: LinkConfidence): ConfidenceTone {
  return TONE_BY_CONFIDENCE[confidence];
}

/**
 * Basis tokens the backend may send (report contract §5.3). Anything else is
 * dropped rather than shown raw — an untranslated token reads as a bug.
 */
export const KNOWN_BASIS: readonly string[] = [
  "cwd",
  "branch",
  "timeWindow",
  "fileOverlap",
  "mtime",
  "author",
  "reflog",
  "siblingWorktree",
];

export function knownBasis(basis: readonly string[]): string[] {
  return basis.filter((token) => KNOWN_BASIS.includes(token));
}

// ── § 시킨 것과 다른 것 — sentence guards ────────────────────────────────────

export interface DriftSentence {
  /** i18n key under `report.drift.`. */
  key: string;
  params: Record<string, string | number>;
}

/**
 * Words that turn a description into a verdict. The page reports what changed;
 * whether that was correct is the reader's call, not ours.
 */
const JUDGEMENT_WORDS: readonly string[] = [
  "잘못",
  "위반",
  "wrong",
  "violation",
  "should",
];

/**
 * Rule 1+2 of §4.7, enforced on the *rendered* string rather than on the key:
 * a sentence with no number and no concrete path is a mood, not a finding, and
 * a sentence with a judgement word is an accusation the data cannot support.
 *
 * A sentence that fails is dropped. The structured lists below it stay — they
 * carry the same facts without the prose.
 */
export function isRenderableSentence(text: string): boolean {
  if (!/\d/.test(text)) return false;
  if (!/[\w-]+[./][\w-]/.test(text)) return false;
  return !JUDGEMENT_WORDS.some((word) => text.toLowerCase().includes(word.toLowerCase()));
}

/**
 * Picks the key and supplies both a count and a concrete path, so the rendered
 * sentence can satisfy `isRenderableSentence`. Returns `null` when there is no
 * concrete path to name — then only the lists render.
 */
export function driftSentence(drift: DriftSection): DriftSentence | null {
  const anchors = drift.mentions.filter((mention) => mention.resolved !== null);
  const anchorPaths = anchors.map((mention) => mention.resolved!.path);

  switch (drift.verdict) {
    case "withinScope": {
      const first = drift.inScopePaths[0] ?? anchorPaths[0];
      if (first === undefined) return null;
      return { key: "withinScope", params: { anchors: anchors.length, first } };
    }
    case "partialDrift": {
      const first = drift.driftedPaths[0]?.path;
      if (first === undefined) return null;
      return {
        key: "partial",
        params: { drifted: drift.driftedTotal, total: drift.changedTotal, first },
      };
    }
    case "fullDrift": {
      if (anchorPaths.length === 0) return null;
      return {
        key: "full",
        params: { anchors: anchorPaths.length, anchorList: anchorPaths.join(", ") },
      };
    }
    case "noAnchor":
      return null;
  }
}

/**
 * G1 — no resolved anchor means the prompt named no scope, and the section is
 * silent. Not "we could not check": most prose prompts name no path, and a
 * standing apology on every session is exactly the noise this page replaced.
 */
export function isDriftRenderable(drift: DriftSection): boolean {
  if (drift.unavailable) return false;
  if (drift.verdict === "noAnchor") return false;
  return drift.mentions.some((mention) => mention.resolved !== null);
}

// ── Session-anchored review ──────────────────────────────────────────────────

/**
 * Review is anchored to the session's attributed commits, not to files: the
 * unit a reader actually finishes is "this session", and commits are the only
 * durable id the backend can persist a mark against.
 */
export type SessionReviewState = "reviewed" | "partial" | "unreviewed";

export function sessionReviewState(
  commitIds: readonly string[],
  states: readonly CommitReviewState[],
): SessionReviewState {
  if (commitIds.length === 0) return "unreviewed";
  const reviewed = new Set(
    states.filter((state) => state.status === "reviewed").map((state) => state.commitId),
  );
  const marked = commitIds.filter((id) => reviewed.has(id)).length;
  if (marked === 0) return "unreviewed";
  return marked === commitIds.length ? "reviewed" : "partial";
}

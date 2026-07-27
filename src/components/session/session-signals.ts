import type { FileEditSummary, LinkConfidence, SessionSummary } from "@/types";

/**
 * How a session→commit correlation may be presented (spec §7-⑧).
 *
 * - `fact`     — state the attribution plainly.
 * - `estimate` — show it, but visibly hedged as a guess.
 * - `hidden`   — do not show it at all. A wrong provenance is worse than none,
 *                so a `low` link never appears next to a commit.
 */
export type LinkPresentation = "fact" | "estimate" | "hidden";

const PRESENTATION_BY_CONFIDENCE: Record<LinkConfidence, LinkPresentation> = {
  high: "fact",
  medium: "estimate",
  low: "hidden",
};

export function linkPresentation(confidence: LinkConfidence): LinkPresentation {
  return PRESENTATION_BY_CONFIDENCE[confidence];
}

/** Basis tokens the backend may send. Anything else is dropped rather than shown raw. */
const KNOWN_BASIS = ["cwd", "branch", "timeWindow", "fileOverlap"];

export function knownBasis(basis: string[]): string[] {
  return basis.filter((token) => KNOWN_BASIS.includes(token));
}

/**
 * V19 — files the session edited without having read them first.
 *
 * `wasReadFirst` is the backend's fold over the log: it is false when no
 * Read/Grep of that path preceded the *first* edit, so a file that was only
 * read afterwards still counts here.
 *
 * This is a review-priority weight, never a defect claim (spec §7-⑨).
 */
export function readLessEdits(summary: SessionSummary): FileEditSummary[] {
  return summary.filesEdited.filter((edit) => !edit.wasReadFirst);
}

/** Session wall-clock duration in milliseconds. Clamped at zero for clock skew. */
export function sessionDurationMs(summary: SessionSummary): number {
  return Math.max(0, summary.endedAt - summary.startedAt);
}

/**
 * §7-⑦ — the parser works to a byte and wall-clock budget, so a log can be read
 * only in part. When it was, every count derived from it is a floor, not a total,
 * and the UI has to say so.
 */
export function isPartialObservation(summary: SessionSummary): boolean {
  return summary.truncated || summary.skippedRecords > 0;
}

export type DurationUnit = "underMinute" | "minutes" | "hours";

export interface DurationParts {
  unit: DurationUnit;
  value: number;
}

/** Splits a duration into a unit + value so the caller picks the i18n key. */
export function durationParts(durationMs: number): DurationParts {
  const minutes = Math.floor(durationMs / 60_000);
  if (minutes < 1) return { unit: "underMinute", value: 0 };
  if (minutes < 60) return { unit: "minutes", value: minutes };
  return { unit: "hours", value: Math.floor(minutes / 60) };
}

/**
 * Review-order weight for one edited file (V19 · V22 · V23 · V24 · V25).
 *
 * This ranks what to read first — it is not a severity and never a verdict.
 * Unread, unrewindable and subagent edits outrank raw churn because a human
 * has demonstrably not seen them.
 */
export function editRiskWeight(edit: FileEditSummary): number {
  const churn = Math.min(edit.editCount, 10);
  return (
    (edit.wasReadFirst ? 0 : 4) +
    (edit.bySubagent ? 3 : 0) +
    (edit.viaBash ? 3 : 0) +
    (edit.afterCompaction ? 2 : 0) +
    churn
  );
}

/** Highest weight first, then path, so the order is stable across renders. */
export function sortEditsByRisk(edits: FileEditSummary[]): FileEditSummary[] {
  return [...edits].sort((a, b) => {
    const byWeight = editRiskWeight(b) - editRiskWeight(a);
    return byWeight !== 0 ? byWeight : a.path.localeCompare(b.path);
  });
}

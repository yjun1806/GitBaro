import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { FileVerdict, StructuralOutcome } from "@/types";

/**
 * Where a structural comparison should be taken from. `oid === null` means the
 * working tree; `staged` then picks index-vs-HEAD over worktree-vs-index.
 */
export interface StructuralTarget {
  repoPath: string;
  oid: string | null;
  staged: boolean;
}

/** Every verdict except `semantic` — a file a reviewer can skip. */
export type NoiseVerdict = Exclude<FileVerdict, "semantic">;

/**
 * The one claim this feature is allowed to make: *this whole file is noise*.
 *
 * Only whole-file verdicts qualify, and every one of them is decided from the
 * file's entire token stream (a reformat, a comment edit, a rename, or a pure
 * permutation of the same tokens). Nothing is inferred from `semanticRanges`:
 * those cover declaration bodies only, so a changed import or a top-level
 * statement lives outside them, and folding by them would hide a real edit
 * behind the word "formatting".
 *
 * Returns `null` for `semantic` and for every `degraded` outcome — in both
 * cases the text diff is the only truth and nothing is folded or claimed.
 */
export function noiseVerdict(outcome: StructuralOutcome | undefined): NoiseVerdict | null {
  if (!outcome || outcome.type !== "compared") return null;
  const { verdict } = outcome.diff;
  return verdict === "semantic" ? null : verdict;
}

export interface StructuralCollapseBarProps {
  verdict: NoiseVerdict;
  /** Diff lines hidden while collapsed. */
  lineCount: number;
  collapsed: boolean;
  onToggle: () => void;
}

/**
 * V1's payoff, as one line: it grants an exemption so the reviewer's attention
 * goes to the files that need it (P6).
 *
 * Collapsing is **deferring, never hiding** — the toggle is always right there
 * and the diff underneath is unchanged.
 */
export function StructuralCollapseBar({
  verdict,
  lineCount,
  collapsed,
  onToggle,
}: StructuralCollapseBarProps) {
  const { t } = useTranslation();
  const Chevron = collapsed ? ChevronRight : ChevronDown;

  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-surface px-3 py-1.5 text-xs text-muted-foreground">
      <span className="flex min-w-0 items-center gap-1.5">
        <Chevron className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">
          {t(`diff.structural.${verdict}`, { count: lineCount })}
        </span>
      </span>
      <button
        type="button"
        onClick={onToggle}
        className="shrink-0 rounded px-2 py-0.5 text-accent transition-colors hover:bg-accent/10"
      >
        {t(collapsed ? "diff.structural.expand" : "diff.structural.collapse")}
      </button>
    </div>
  );
}

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { Severity, Unavailable } from "@/types";

/**
 * The report's presentation vocabulary. Deliberately small: three tones, one
 * chip, one section frame, one unavailable line.
 *
 * There is no "clear" / "passed" variant anywhere in this file, and there is no
 * check-mark icon. The page states what it found and what it could not check;
 * it never issues an all-clear.
 */

export type Tone = "muted" | "info" | "warning" | "danger";

const CHIP_CLASS: Record<Tone, string> = {
  muted: "border-border bg-muted text-muted-foreground",
  info: "border-info/40 bg-info/10 text-info",
  warning: "border-warning/40 bg-warning/10 text-warning",
  danger: "border-danger/40 bg-danger/10 text-danger",
};

const TEXT_CLASS: Record<Tone, string> = {
  muted: "text-muted-foreground",
  info: "text-info",
  warning: "text-warning",
  danger: "text-danger",
};

export const TONE_BY_SEVERITY: Record<Severity, Tone> = {
  info: "info",
  warn: "warning",
  danger: "danger",
};

export function toneTextClass(tone: Tone): string {
  return TEXT_CLASS[tone];
}

interface ChipProps {
  label: string;
  tone?: Tone;
  icon?: React.ElementType;
  /** Native tooltip — the home for the detail that did not earn its own line. */
  title?: string;
  className?: string;
}

export function Chip({ label, tone = "muted", icon: Icon, title, className }: ChipProps) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] leading-none",
        CHIP_CLASS[tone],
        className,
      )}
    >
      {Icon && <Icon className="h-3 w-3" />}
      {label}
    </span>
  );
}

/**
 * The `추정` chip. Anything the session→commit link produced below `high`
 * confidence carries one, and the basis is spelled out in its tooltip — a guess
 * is never presented as fact (report contract §5.6).
 */
export function EstimateChip({ basis }: { basis?: string[] }) {
  const { t } = useTranslation();
  const reasons = (basis ?? []).map((token) => t(`report.basis.${token}`));

  return (
    <Chip
      label={t("report.confidence.estimate")}
      tone="warning"
      title={reasons.length > 0 ? reasons.join(" · ") : undefined}
    />
  );
}

interface SectionShellProps {
  /** The question this section answers, as the reader asked it. */
  title: string;
  /** One line of context, only when it changes what the reader does. */
  note?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
}

export function SectionShell({ title, note, trailing, children }: SectionShellProps) {
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-baseline gap-2">
        <h2 className="text-xs font-semibold tracking-tight">{title}</h2>
        {note && <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{note}</span>}
        {trailing && <span className="ml-auto shrink-0">{trailing}</span>}
      </header>
      {children}
    </section>
  );
}

interface UnavailableNoteProps {
  unavailable: Unavailable;
  /** A button that removes the reason, when one exists (e.g. build the index). */
  action?: ReactNode;
}

/**
 * One sentence saying what could not be checked, plus the action that would fix
 * it. Never a placeholder panel and never an apology — the reason itself is the
 * information ("the symbol index is missing, so call sites were not resolved").
 */
export function UnavailableNote({ unavailable, action }: UnavailableNoteProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border px-3 py-2">
      <p className="min-w-0 flex-1 text-[11px] text-muted-foreground">
        {t(`report.unavailable.${unavailable.reason}`)}
        {unavailable.detail && (
          <span className="ml-1 font-mono text-[10px] opacity-80">{unavailable.detail}</span>
        )}
      </p>
      {action}
    </div>
  );
}

/** A repository-relative path. Always monospace, always full text on hover. */
export function PathText({ path, className }: { path: string; className?: string }) {
  return (
    <span title={path} className={cn("truncate font-mono text-xs", className)}>
      {path}
    </span>
  );
}

/** `+12 −4`. Renders nothing when the attribution did not produce line counts. */
export function LineDelta({
  added,
  removed,
}: {
  added: number | null;
  removed: number | null;
}) {
  if (added === null && removed === null) return null;

  return (
    <span className="shrink-0 font-mono text-[10px]">
      <span className="text-success">+{added ?? 0}</span>{" "}
      <span className="text-danger">−{removed ?? 0}</span>
    </span>
  );
}

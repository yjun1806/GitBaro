import { useTranslation } from "react-i18next";
import { Bot, FlaskConical, Scissors, ShieldAlert, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  OrdealEvent,
  OrdealKind,
  TestEditAfterFailure,
  WentThroughSection as WentThroughSectionData,
} from "@/types";
import {
  Chip,
  PathText,
  SectionShell,
  TONE_BY_SEVERITY,
  toneTextClass,
  UnavailableNote,
} from "./atoms";
import { buildOrdealTimeline, sectionState, type OrdealBeat } from "./report-model";

const KIND_ICON: Record<OrdealKind, React.ElementType> = {
  testPassed: FlaskConical,
  testFailed: FlaskConical,
  hookBypass: ShieldAlert,
  shellMutation: Terminal,
  compaction: Scissors,
  subagentEdit: Bot,
};

/**
 * § 무엇을 겪었나 — the run, in order.
 *
 * This section is a **sequence**, not a list, because the order is the finding:
 * "failed three times, then edited the test file" only exists as an ordering.
 * A sorted-by-severity list of the same events says nothing.
 *
 * `testEditsAfterFailure` is promoted above the rail. It is the single line on
 * this page most likely to change what the reader does next, so it does not
 * have to be found inside a 120-event stream.
 */
export function WentThroughSection({ went }: { went: WentThroughSectionData }) {
  const { t } = useTranslation();
  const hasContent =
    went.events.length > 0 || went.testEditsAfterFailure.length > 0 || went.neverRanTests;
  const state = sectionState(went.unavailable, hasContent);
  if (state === "hidden") return null;

  const beats = buildOrdealTimeline(went.events);

  return (
    <SectionShell
      title={t("report.section.wentThrough")}
      note={t("report.wentThrough.counts", {
        bash: went.bashTotal,
        runs: went.testRuns,
        failed: went.failedTestRuns,
      })}
    >
      {state === "explain" && went.unavailable ? (
        <UnavailableNote unavailable={went.unavailable} />
      ) : (
        <>
          {went.testEditsAfterFailure.map((edit) => (
            <TestEditCallout key={`${edit.testPath}-${edit.editedAt}`} edit={edit} />
          ))}

          {went.neverRanTests && (
            <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning">
              {t("report.wentThrough.neverRanTests")}
            </p>
          )}

          {beats.length > 0 && (
            <ol className="flex flex-col">
              {beats.map((beat, index) => (
                <BeatRow
                  key={`${beat.event.at}-${beat.event.kind}-${index}`}
                  beat={beat}
                  isLast={index === beats.length - 1}
                />
              ))}
            </ol>
          )}
        </>
      )}
    </SectionShell>
  );
}

/**
 * "The test failed 3 times, then this test file was edited." The page states
 * the sequence and names the file; whether that edit was legitimate is the
 * reader's call, and this component never implies otherwise.
 */
function TestEditCallout({ edit }: { edit: TestEditAfterFailure }) {
  const { t } = useTranslation();

  return (
    <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
      <p className="text-[11px] font-medium text-danger">
        {t("report.wentThrough.testEditAfterFailure", {
          count: edit.failuresBefore,
          path: edit.testPath,
        })}
      </p>
      {edit.failingCommands.length > 0 && (
        <ul className="mt-1 flex flex-col gap-0.5">
          {edit.failingCommands.map((command, index) => (
            <li
              key={`${index}-${command}`}
              title={command}
              className="truncate font-mono text-[10px] text-muted-foreground"
            >
              {command}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One beat on the rail. `repeats > 1` reads as one event that happened N times. */
function BeatRow({ beat, isLast }: { beat: OrdealBeat; isLast: boolean }) {
  const { t } = useTranslation();
  const Icon = KIND_ICON[beat.event.kind];
  const tone = TONE_BY_SEVERITY[beat.event.severity];

  return (
    <li className="flex gap-2">
      <div className="flex flex-col items-center">
        <Icon className={cn("mt-1 h-3.5 w-3.5 shrink-0", toneTextClass(tone))} />
        {!isLast && <span className="w-px flex-1 bg-border" />}
      </div>

      <div className="min-w-0 flex-1 pb-2">
        <div className="flex items-center gap-1.5">
          <span className={cn("shrink-0 text-[10px] font-medium", toneTextClass(tone))}>
            {t(`report.wentThrough.kind.${beat.event.kind}`)}
          </span>
          {beat.repeats > 1 && (
            <Chip tone={tone} label={t("report.wentThrough.repeats", { count: beat.repeats })} />
          )}
        </div>
        <EventEvidence event={beat.event} />
      </div>
    </li>
  );
}

/**
 * The command or path, verbatim. Agent-authored text is never translated and
 * never summarised — a paraphrased command cannot be re-run.
 */
function EventEvidence({ event }: { event: OrdealEvent }) {
  if (event.kind === "shellMutation" || event.kind === "subagentEdit") {
    return (
      <div className="flex flex-col">
        <PathText path={event.evidence} className="text-[11px] text-muted-foreground" />
        {event.detail && (
          <span className="truncate font-mono text-[10px] text-muted-foreground" title={event.detail}>
            {event.detail}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <span
        title={event.evidence}
        className="truncate font-mono text-[11px] text-muted-foreground"
      >
        {event.evidence}
      </span>
      {event.detail && (
        <span className="truncate font-mono text-[10px] text-warning" title={event.detail}>
          {event.detail}
        </span>
      )}
    </div>
  );
}

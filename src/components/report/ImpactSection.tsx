import { useTranslation } from "react-i18next";
import { useSymbolIndex } from "@/hooks/useSymbolIndex";
import type { BlastRadiusEntry, ImpactSection as ImpactSectionData } from "@/types";
import { Chip, EstimateChip, PathText, SectionShell, UnavailableNote } from "./atoms";
import { elidedCallerCount, sectionState, untouchedCallSites } from "./report-model";

interface ImpactSectionProps {
  repoPath: string;
  impact: ImpactSectionData;
  /** True when the session→commit link is an estimate, so the baseline is too. */
  isEstimate: boolean;
}

/**
 * § 무엇이 영향받나 — call sites of changed signatures that this session did
 * **not** update.
 *
 * Only that list is actionable, so only that list is rendered. A signature
 * change whose callers were all updated has nothing to say and the backend
 * already dropped it.
 *
 * Without a symbol index there is no answer at all. That is stated once, with
 * the button that fixes it — the button lives here, inside a page the user
 * already opened, so it is an action and not a nag.
 */
export function ImpactSection({ repoPath, impact, isEstimate }: ImpactSectionProps) {
  const { t } = useTranslation();
  const state = sectionState(impact.unavailable, impact.entries.length > 0);
  if (state === "hidden") return null;

  return (
    <SectionShell
      title={t("report.section.impact")}
      note={
        state === "ready"
          ? t("report.impact.counts", { count: impact.totalUntouchedCallers })
          : undefined
      }
      trailing={isEstimate && state === "ready" ? <EstimateChip /> : undefined}
    >
      {state === "explain" && impact.unavailable ? (
        <UnavailableNote
          unavailable={impact.unavailable}
          action={<BuildIndexButton repoPath={repoPath} />}
        />
      ) : (
        <>
          {impact.basis === "worktreeFallback" && (
            <p className="text-[11px] text-muted-foreground">
              {t("report.impact.worktreeFallback")}
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {impact.entries.map((entry) => (
              <EntryRow key={`${entry.file}:${entry.symbol}`} entry={entry} />
            ))}
          </ul>
        </>
      )}
    </SectionShell>
  );
}

/**
 * Building the index is opt-in and can take minutes, so it only ever starts
 * from this click — never on mount.
 */
function BuildIndexButton({ repoPath }: { repoPath: string }) {
  const { t } = useTranslation();
  const { isBuilding, isPending, progress, build } = useSymbolIndex(repoPath);

  if (isBuilding) {
    return (
      <span className="shrink-0 text-[11px] text-muted-foreground">
        {t("report.impact.building", {
          done: progress?.filesDone ?? 0,
          total: progress?.filesTotal ?? 0,
        })}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={build}
      disabled={isPending}
      className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] transition-colors hover:bg-accent disabled:opacity-50"
    >
      {t("report.impact.buildIndex")}
    </button>
  );
}

function EntryRow({ entry }: { entry: BlastRadiusEntry }) {
  const { t } = useTranslation();
  const untouched = untouchedCallSites(entry);
  const elided = elidedCallerCount(entry);

  return (
    <li className="rounded-md border border-border px-2.5 py-2">
      <div className="flex flex-wrap items-baseline gap-1.5">
        <span className="font-mono text-xs font-medium">{entry.symbol}</span>
        <PathText path={entry.file} className="text-[10px] text-muted-foreground" />
        <Chip
          tone="warning"
          label={t("report.impact.untouchedCallers", { count: entry.untouchedCallerCount })}
        />
      </div>

      {entry.resolution.type === "nameAmbiguous" && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          {t("report.impact.nameAmbiguous", { count: entry.resolution.definitions })}
        </p>
      )}

      <ul className="mt-1 flex flex-col">
        {untouched.map((site) => (
          <li
            key={`${site.file}:${site.line}`}
            className="flex items-baseline gap-1.5 truncate text-[11px]"
          >
            <PathText path={site.file} className="text-muted-foreground" />
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              :{site.line}
            </span>
            {site.symbol && (
              <span className="truncate font-mono text-[10px]">{site.symbol}</span>
            )}
          </li>
        ))}
      </ul>

      {elided > 0 && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          {t("report.impact.moreCallers", { count: elided })}
        </p>
      )}
    </li>
  );
}

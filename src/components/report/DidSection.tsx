import { useTranslation } from "react-i18next";
import { Bot, EyeOff, FlaskConical, Repeat, Scissors, Terminal } from "lucide-react";
import { truncateHash } from "@/lib/utils";
import { Disclosure } from "@/components/ui/Disclosure";
import type { DidSection as DidSectionData, ReportCommit, TouchedFile } from "@/types";
import { Chip, EstimateChip, LineDelta, PathText, SectionShell, UnavailableNote } from "./atoms";
import {
  churnEmphasis,
  confidenceTone,
  knownBasis,
  rankTouchedFiles,
  sectionState,
} from "./report-model";

/**
 * § 무엇을 했나 — commits, files, and how many times each file was rewritten.
 *
 * The file list is ranked by churn because that is the one number here that
 * points somewhere: a file edited seven times is where the agent struggled, and
 * it is where the reader should look first. It is the first row for that reason.
 *
 * The commit half depends on session→commit correlation and can be unavailable;
 * the file half comes from the session log and never is. That is why the two
 * halves are rendered independently instead of behind one guard.
 */
export function DidSection({ did }: { did: DidSectionData }) {
  const { t } = useTranslation();
  const files = rankTouchedFiles(did.files);
  // Only the commit half can be unavailable, so it gets its own state; the file
  // half comes from the log and is rendered whenever there is one.
  const commitState = sectionState(did.unavailable, did.commits.length > 0);
  if (commitState === "hidden" && files.length === 0) return null;

  const isEstimate =
    did.attribution !== null && confidenceTone(did.attribution.confidence) === "estimate";

  return (
    <SectionShell
      title={t("report.section.did")}
      note={t("report.did.counts", {
        edited: did.filesEditedCount,
        read: did.filesReadCount,
      })}
    >
      {commitState === "explain" && did.unavailable && (
        <UnavailableNote unavailable={did.unavailable} />
      )}

      {commitState === "ready" && (
        <ul className="flex flex-col gap-1.5">
          {did.commits.map((commit) => (
            <CommitRow key={commit.commitId} commit={commit} />
          ))}
        </ul>
      )}

      {isEstimate && did.attribution && (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <EstimateChip basis={knownBasis(did.attribution.basis)} />
          {t("report.did.estimateNote")}
        </p>
      )}

      {did.attribution && did.attribution.rejected.length > 0 && (
        <Disclosure
          className="rounded-md border border-border"
          summaryClassName="px-2.5 py-1.5"
          bodyClassName="border-t border-border px-2.5 py-2"
          summary={
            <span className="text-[11px] text-muted-foreground">
              {t("report.did.rejected", { count: did.attribution.rejected.length })}
            </span>
          }
        >
          <ul className="flex flex-col gap-1">
            {did.attribution.rejected.map((rejected) => (
              <li key={rejected.commitId} className="flex items-center gap-2 text-[11px]">
                <span className="font-mono text-muted-foreground">
                  {truncateHash(rejected.commitId)}
                </span>
                <span className="text-muted-foreground">
                  {t(`report.did.rejection.${rejected.reason}`)}
                </span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}

      {files.length > 0 && (
        <ul className="overflow-hidden rounded-md border border-border">
          {files.map((file) => (
            <FileRow key={file.path} file={file} />
          ))}
        </ul>
      )}

      {did.uncommittedPaths.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {t("report.did.uncommitted", {
            count: did.uncommittedPaths.length,
            first: did.uncommittedPaths[0],
          })}
        </p>
      )}
    </SectionShell>
  );
}

function CommitRow({ commit }: { commit: ReportCommit }) {
  const { t } = useTranslation();

  return (
    <li className="rounded-md border border-border px-2.5 py-2">
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {truncateHash(commit.commitId)}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs" title={commit.summary}>
          {commit.summary}
        </span>
        <LineDelta added={commit.insertions} removed={commit.deletions} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
        <span>{commit.authorName}</span>
        <span aria-hidden>·</span>
        <span>{t("report.did.filesChanged", { count: commit.filesChanged })}</span>
        {commit.unattributedFiles.length > 0 && (
          <Chip
            tone="warning"
            label={t("report.did.unattributedFiles", {
              count: commit.unattributedFiles.length,
            })}
            title={commit.unattributedFiles.join("\n")}
          />
        )}
      </div>
    </li>
  );
}

/**
 * One edited file. Every chip here is a reason to read the file, never a defect
 * claim: the page cannot tell whether an unread edit was wrong, only that no
 * one looked at the file before changing it.
 */
function FileRow({ file }: { file: TouchedFile }) {
  const { t } = useTranslation();
  const emphasis = churnEmphasis(file.editCount);

  return (
    <li className="flex flex-col gap-1 border-b border-border px-2.5 py-1.5 last:border-b-0">
      <div className="flex items-center gap-2">
        {emphasis !== "none" && (
          <Chip
            icon={Repeat}
            tone={emphasis === "strong" ? "warning" : "muted"}
            label={t("report.did.editCount", { count: file.editCount })}
            title={t("report.did.churnNote")}
          />
        )}
        <PathText path={file.path} className="min-w-0 flex-1" />
        <LineDelta added={file.addedLines} removed={file.removedLines} />
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {!file.wasReadFirst && (
          <Chip
            icon={EyeOff}
            tone="warning"
            label={t("report.did.notReadFirst")}
            title={t("report.did.notReadFirstNote")}
          />
        )}
        {file.viaBash && (
          <Chip
            icon={Terminal}
            tone="warning"
            label={t("report.did.viaBash")}
            title={t("report.did.viaBashNote")}
          />
        )}
        {file.bySubagent && (
          <Chip
            icon={Bot}
            tone="muted"
            label={t("report.did.bySubagent")}
            title={t("report.did.bySubagentNote")}
          />
        )}
        {file.afterCompaction && (
          <Chip
            icon={Scissors}
            tone="muted"
            label={t("report.did.afterCompaction")}
            title={t("report.did.afterCompactionNote")}
          />
        )}
        {file.isTest && <Chip icon={FlaskConical} tone="muted" label={t("report.did.testFile")} />}
        {!file.inCommit && <Chip tone="muted" label={t("report.did.notInCommit")} />}
      </div>
    </li>
  );
}

import { useTranslation } from "react-i18next";
import type { DriftSection as DriftSectionData, PromptMention } from "@/types";
import { Chip, EstimateChip, LineDelta, PathText, SectionShell } from "./atoms";
import {
  confidenceTone,
  driftSentence,
  isDriftRenderable,
  isRenderableSentence,
} from "./report-model";

/**
 * § 시킨 것과 다른 것 — the scope the prompt named against the paths that
 * actually changed (V26).
 *
 * When the prompt named no scope, this renders **nothing**. Not an empty box,
 * not "could not check": most real prompts ("로그인 리팩터링 해줘") name no
 * path, and the honest answer to "did it go outside what you asked?" is silence
 * rather than a standing apology (G1).
 */
export function DriftSection({ drift }: { drift: DriftSectionData }) {
  const { t } = useTranslation();
  if (!isDriftRenderable(drift)) return null;

  const sentence = driftSentence(drift);
  const rendered = sentence ? t(`report.drift.${sentence.key}`, sentence.params) : null;
  // §4.7 rules 1-2, checked against the string that will actually be shown: a
  // sentence with no number and no path is a mood, and a judgement word is an
  // accusation the data cannot support. Either way it is dropped and the lists
  // below carry the facts on their own.
  const sentenceText = rendered && isRenderableSentence(rendered) ? rendered : null;

  const isEstimate = confidenceTone(drift.confidence) !== "fact";
  const resolved = drift.mentions.filter((mention) => mention.resolved !== null);
  const unresolved = drift.mentions.filter((mention) => mention.resolved === null);
  const elided = drift.driftedTotal - drift.driftedPaths.length;

  return (
    <SectionShell title={t("report.section.drift")}>
      {sentenceText && (
        <p className="flex items-start gap-1.5 text-xs leading-relaxed">
          {isEstimate && <EstimateChip />}
          <span className="min-w-0 flex-1">{sentenceText}</span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1">
        {resolved.map((mention) => (
          <MentionChip key={`${mention.promptOrdinal}-${mention.raw}`} mention={mention} />
        ))}
      </div>

      {drift.driftedPaths.length > 0 && (
        <ul className="overflow-hidden rounded-md border border-border">
          {drift.driftedPaths.map((path) => (
            <li
              key={path.path}
              className="flex items-center gap-2 border-b border-border px-2.5 py-1.5 last:border-b-0"
            >
              <PathText path={path.path} className="min-w-0 flex-1" />
              {path.editCount > 1 && (
                <Chip tone="muted" label={t("report.did.editCount", { count: path.editCount })} />
              )}
              <LineDelta added={path.addedLines} removed={path.removedLines} />
            </li>
          ))}
        </ul>
      )}

      {elided > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {t("report.drift.morePaths", { count: elided })}
        </p>
      )}

      {unresolved.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {t("report.drift.unresolved", {
            count: unresolved.length,
            mentions: unresolved.map((mention) => mention.raw).join(", "),
          })}
        </p>
      )}
    </SectionShell>
  );
}

/** One thing the prompt named that the repository could resolve. */
function MentionChip({ mention }: { mention: PromptMention }) {
  const { t } = useTranslation();
  const anchor = mention.resolved!;

  return (
    <Chip
      tone="info"
      label={anchor.path}
      title={t("report.drift.mentionNote", {
        raw: mention.raw,
        kind: t(`report.drift.anchorKind.${anchor.kind}`),
      })}
    />
  );
}

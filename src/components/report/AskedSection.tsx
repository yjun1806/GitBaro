import { useTranslation } from "react-i18next";
import { Scissors } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import type { AskedSection as AskedSectionData, PromptRecord } from "@/types";
import { Chip, SectionShell, UnavailableNote } from "./atoms";
import { msToUnixSeconds, sectionState } from "./report-model";

/**
 * § 무엇을 시켰나 — the user's own words, verbatim.
 *
 * This is the one thing on the page the agent could not rewrite, and everything
 * below is judged against it, so it leads and it is quoted in full. No summary,
 * no translation, no highlighting: a paraphrase here would defeat the section.
 *
 * The only judgement made is `compactedAway` — "the instruction you gave third
 * may have been dropped by context compaction" is a sentence that changes what
 * the reader checks next.
 */
export function AskedSection({ asked }: { asked: AskedSectionData }) {
  const { t } = useTranslation();
  const state = sectionState(asked.unavailable, asked.prompts.length > 0);
  if (state === "hidden") return null;

  const [first, ...followUps] = asked.prompts;
  const hiddenCount = asked.totalPrompts - asked.prompts.length;

  return (
    <SectionShell title={t("report.section.asked")}>
      {state === "explain" && asked.unavailable ? (
        <UnavailableNote unavailable={asked.unavailable} />
      ) : (
        <div className="flex flex-col gap-2">
          <PromptBlock prompt={first} isAnchor />
          {followUps.map((prompt) => (
            <PromptBlock key={prompt.ordinal} prompt={prompt} isAnchor={false} />
          ))}
          {hiddenCount > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {t("report.asked.morePrompts", { count: hiddenCount })}
            </p>
          )}
        </div>
      )}
    </SectionShell>
  );
}

interface PromptBlockProps {
  prompt: PromptRecord;
  /** The first prompt is the specification; follow-ups are corrections to it. */
  isAnchor: boolean;
}

function PromptBlock({ prompt, isAnchor }: PromptBlockProps) {
  const { t } = useTranslation();

  return (
    <article
      className={
        isAnchor
          ? "rounded-md border-l-2 border-primary bg-surface px-3 py-2.5"
          : "rounded-md border-l-2 border-border bg-surface/60 px-3 py-2"
      }
    >
      <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
        <span>
          {isAnchor
            ? t("report.asked.firstPrompt")
            : t("report.asked.followUp", { ordinal: prompt.ordinal + 1 })}
        </span>
        <span aria-hidden>·</span>
        <span>{formatRelativeTime(msToUnixSeconds(prompt.at))}</span>
        {prompt.compactedAway && (
          <Chip
            icon={Scissors}
            tone="warning"
            label={t("report.asked.compactedAway")}
            title={t("report.asked.compactedAwayNote")}
          />
        )}
      </div>
      <p
        className={
          isAnchor
            ? "whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground"
            : "whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground"
        }
      >
        {prompt.text}
      </p>
      {prompt.truncated && (
        <p className="mt-1 text-[10px] text-muted-foreground">{t("report.asked.truncated")}</p>
      )}
    </article>
  );
}

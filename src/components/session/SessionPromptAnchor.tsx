import { useTranslation } from "react-i18next";
import { Quote } from "lucide-react";

interface SessionPromptAnchorProps {
  prompt: string | null;
}

/**
 * V26 — the original user prompt, rendered as the anchor of the whole screen.
 *
 * The commit message is the agent's own after-the-fact summary of its work; the
 * prompt is the one part of the record the agent could not rewrite, so it is the
 * more authoritative specification (spec §P8). It is shown in full and never
 * summarised — the human comparison against what actually changed is the point,
 * and that judgement cannot be delegated (spec §7-⑪).
 */
export function SessionPromptAnchor({ prompt }: SessionPromptAnchorProps) {
  const { t } = useTranslation();

  return (
    <section className="rounded-md border border-border bg-surface">
      <header className="flex items-center gap-1.5 px-3 pt-2.5">
        <Quote className="w-3.5 h-3.5 text-muted-foreground" />
        <h3 className="text-xs font-semibold">{t("verify.session.firstPrompt")}</h3>
      </header>
      {prompt ? (
        <p className="px-3 py-2 text-sm whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
          {prompt}
        </p>
      ) : (
        <p className="px-3 py-2 text-sm text-muted-foreground">
          {t("verify.session.noPrompt")}
        </p>
      )}
      <p className="px-3 pb-2.5 text-[11px] text-muted-foreground">
        {t("verify.session.firstPromptNote")}
      </p>
    </section>
  );
}

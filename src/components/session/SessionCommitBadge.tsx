import { useTranslation } from "react-i18next";
import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { knownBasis, linkPresentation } from "./session-signals";
import type { SessionCommitLink } from "@/types";

interface SessionCommitBadgeProps {
  link: SessionCommitLink;
}

/**
 * V30 — "an agent session plausibly produced this commit".
 *
 * The correlation is a heuristic (cwd + branch + time window + file overlap), so
 * spec §7-⑧ governs how it may be rendered: `high` is stated plainly, `medium`
 * is visibly hedged, and `low` is not rendered at all. Misattribution is worse
 * than no attribution, so this component returns `null` rather than guess.
 *
 * Renders a non-interactive `<span>` on purpose — it is meant to sit inside the
 * `trailing` slot of `CommitItem`, which is itself a button.
 */
export function SessionCommitBadge({ link }: SessionCommitBadgeProps) {
  const { t } = useTranslation();
  const presentation = linkPresentation(link.confidence);

  if (presentation === "hidden") return null;

  const basis = knownBasis(link.basis)
    .map((token) => t(`verify.session.link.basis.${token}`))
    .join(", ");

  const tooltip = [
    t("verify.session.link.title"),
    basis ? t("verify.session.link.basisLabel", { basis }) : "",
    presentation === "estimate" ? t("verify.session.link.estimateNote") : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <span
      title={tooltip}
      className={cn(
        "inline-flex items-center gap-1 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] leading-none",
        presentation === "fact"
          ? "bg-info/10 text-info"
          : "border border-dashed border-border text-muted-foreground",
      )}
    >
      <Bot className="w-3 h-3" />
      <span>{t(`verify.session.link.confidence.${link.confidence}`)}</span>
    </span>
  );
}

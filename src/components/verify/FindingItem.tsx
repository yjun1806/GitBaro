import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import type { Finding } from "@/types";
import { cn } from "@/lib/utils";
import { SEVERITY_ICON, SEVERITY_TEXT_CLASS } from "./severity";
import { findingScope } from "./rules";

export interface FindingItemProps {
  finding: Finding;
  /** Jump to the file (and line, when the rule could pinpoint one) in the diff. */
  onNavigate?: (file: string, line: number | null) => void;
}

/**
 * One finding in two fixed lines: what the rule is, and the evidence sentence
 * the backend produced (rendered verbatim — only titles are translated).
 *
 * The rule description, the raw detail and the rule id all live behind the
 * "evidence" toggle. Severity is carried by the icon alone; the chip that
 * repeated it in words was width the file path needed more.
 */
export function FindingItem({ finding, onNavigate }: FindingItemProps) {
  const { t } = useTranslation();
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  const scope = findingScope(finding);
  const Icon = SEVERITY_ICON[finding.severity];
  const title = t(`verify.rule.${finding.ruleId}.title`, { defaultValue: finding.ruleId });
  const description = t(`verify.rule.${finding.ruleId}.description`, { defaultValue: "" });
  const canNavigate = scope === "file" && onNavigate !== undefined;
  const location =
    finding.line !== null
      ? `${finding.file} · ${t("verify.finding.line", { line: finding.line })}`
      : finding.file;

  return (
    <li className="border-b border-border last:border-b-0 px-3 py-1.5">
      <div className="flex items-start gap-1.5">
        <Icon
          className={cn("w-3.5 h-3.5 mt-0.5 shrink-0", SEVERITY_TEXT_CLASS[finding.severity])}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="shrink-0 text-xs font-semibold text-foreground">{title}</span>
            {scope !== "file" && (
              <span className="shrink-0 rounded-full border border-border bg-muted px-1.5 py-px text-xs text-muted-foreground">
                {scope === "session"
                  ? t("verify.finding.sessionLevel")
                  : t("verify.finding.commitLevel")}
              </span>
            )}
            <span className="flex-1" />
            {canNavigate ? (
              <button
                type="button"
                onClick={() => onNavigate(finding.file, finding.line)}
                title={t("verify.finding.jumpToFile")}
                className="min-w-0 truncate text-right text-xs text-primary hover:underline"
              >
                {location}
              </button>
            ) : (
              finding.file !== "" && (
                <span className="min-w-0 truncate text-right text-xs text-muted-foreground">
                  {location}
                </span>
              )
            )}
          </div>

          <p className="truncate text-xs text-foreground" title={finding.message}>
            {finding.message}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsDetailOpen((open) => !open)}
          aria-expanded={isDetailOpen}
          aria-label={t("verify.finding.evidence")}
          title={t("verify.finding.evidence")}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronDown
            className={cn("w-3 h-3 transition-transform", !isDetailOpen && "-rotate-90")}
          />
        </button>
      </div>

      {isDetailOpen && (
        <div className="mt-1 pl-5">
          {description !== "" && (
            <p className="text-xs text-muted-foreground break-words">{description}</p>
          )}
          {finding.detail !== null && (
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted px-2 py-1 text-xs text-muted-foreground">
              {finding.detail}
            </pre>
          )}
          <p className="mt-1 font-mono text-xs text-muted-foreground/70">{finding.ruleId}</p>
        </div>
      )}
    </li>
  );
}

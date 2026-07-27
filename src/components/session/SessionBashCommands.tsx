import { useTranslation } from "react-i18next";
import { XCircle, MinusCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BashCommandKind, BashCommandRecord } from "@/types";

interface SessionBashCommandsProps {
  commands: BashCommandRecord[];
}

const KIND_CLASSES: Record<BashCommandKind, string> = {
  testRun: "bg-info/10 text-info",
  hookBypass: "bg-danger/10 text-danger",
  fileMutation: "bg-warning/10 text-warning",
  other: "bg-muted text-muted-foreground",
};

/**
 * V20 · V21 · V22 — the shell the agent actually ran.
 *
 * Test runs and their pass/fail carry the V20 audit; `hookBypass` is the only
 * evidence a bypass ever happened, because it leaves no trace in the diff (V21).
 * The failure→test-edit *sequence* is derived by the backend and rendered by
 * `SessionFindings`; this list is the raw record it was derived from.
 */
export function SessionBashCommands({ commands }: SessionBashCommandsProps) {
  const { t } = useTranslation();

  const testRuns = commands.filter((c) => c.kind === "testRun");
  const failedTestRuns = testRuns.filter((c) => c.isError).length;

  return (
    <section className="rounded-md border border-border overflow-hidden">
      <header className="flex items-center gap-1.5 px-3 py-2 bg-surface flex-wrap">
        <h3 className="text-xs font-semibold">{t("verify.session.headingCommands")}</h3>
        <span className="text-[10px] text-muted-foreground">
          {t("verify.session.commands", { count: commands.length })}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {t("verify.session.testRunTally", {
            total: testRuns.length,
            failed: failedTestRuns,
          })}
        </span>
      </header>

      {commands.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          {t("verify.session.noCommands")}
        </p>
      ) : (
        <ul className="max-h-72 overflow-y-auto">
          {commands.map((command, index) => (
            <li
              key={`${command.at}-${index}`}
              className="flex items-start gap-2 px-3 py-1.5 border-b border-border last:border-b-0"
            >
              {command.isError ? (
                <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-danger" />
              ) : (
                <MinusCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />
              )}
              <code
                className="flex-1 min-w-0 text-xs font-mono break-all"
                title={command.command}
              >
                {command.command}
              </code>
              <span
                className={cn(
                  "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] leading-none",
                  KIND_CLASSES[command.kind],
                )}
              >
                {t(`verify.session.commandKind.${command.kind}`)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="px-3 py-2 text-[11px] text-muted-foreground border-t border-border">
        {t("verify.session.commandOutcomeNote")}
      </p>
    </section>
  );
}

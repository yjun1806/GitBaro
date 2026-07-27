import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import type { RuleDescriptor } from "@/types";
import { useVerifyRuleMutation, useVerifyRules } from "@/api/queries";
import { useToastStore } from "@/stores/toast";
import { cn, getErrorMessage } from "@/lib/utils";
import { SEVERITY_CHIP_CLASS } from "./severity";
import { countRuleStatuses } from "./rules";
import { groupRulesByCategory } from "./rule-categories";

interface RuleRowProps {
  rule: RuleDescriptor;
  onToggle: (ruleId: string, enabled: boolean) => void;
  isPending: boolean;
}

function RuleRow({ rule, onToggle, isPending }: RuleRowProps) {
  const { t } = useTranslation();
  const isPlanned = rule.status === "planned";

  return (
    <li className="flex items-start gap-3 border-b border-border px-3 py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={cn(
              "text-xs font-medium",
              isPlanned ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {t(`verify.rule.${rule.ruleId}.title`, { defaultValue: rule.ruleId })}
          </span>
          <span
            className={cn(
              "rounded-full border px-1.5 py-px text-xs shrink-0",
              SEVERITY_CHIP_CLASS[rule.defaultSeverity],
            )}
            title={t("verify.settings.defaultSeverity")}
          >
            {t(`verify.severity.${rule.defaultSeverity}`)}
          </span>
          {isPlanned && (
            <span className="rounded-full border border-border bg-muted px-1.5 py-px text-xs text-muted-foreground shrink-0">
              {t("verify.status.planned")}
            </span>
          )}
        </div>

        <p className="mt-0.5 text-xs text-muted-foreground break-words">
          {t(`verify.rule.${rule.ruleId}.description`, { defaultValue: "" })}
        </p>
        {isPlanned && (
          <p className="mt-0.5 text-xs text-warning">{t("verify.settings.plannedNote")}</p>
        )}
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={rule.enabled && !isPlanned}
        aria-label={t(`verify.rule.${rule.ruleId}.title`, { defaultValue: rule.ruleId })}
        disabled={isPlanned || isPending}
        onClick={() => onToggle(rule.ruleId, !rule.enabled)}
        className={cn(
          "mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
          rule.enabled && !isPlanned ? "bg-primary border-primary" : "bg-muted border-border",
        )}
        title={rule.enabled ? t("verify.settings.on") : t("verify.settings.off")}
      >
        <span
          className={cn(
            "block h-3.5 w-3.5 rounded-full bg-background transition-transform",
            rule.enabled && !isPlanned ? "translate-x-[18px]" : "translate-x-[3px]",
          )}
        />
      </button>
    </li>
  );
}

export interface RuleSettingsProps {
  className?: string;
}

/**
 * Every registry rule, grouped into user-facing categories — planned ones
 * included as disabled
 * rows on purpose, so the list doubles as the answer to "what is this tool NOT
 * checking?" (spec §7-①). Turning a rule off never turns it into a pass: it
 * moves to the report's `unchecked` list with reason `disabled`.
 */
export function RuleSettings({ className }: RuleSettingsProps) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const { data: rules, isLoading, error } = useVerifyRules();
  const toggleRule = useVerifyRuleMutation();

  const groups = useMemo(() => groupRulesByCategory(rules ?? []), [rules]);
  const statusCounts = useMemo(() => countRuleStatuses(rules ?? []), [rules]);

  const handleToggle = (ruleId: string, enabled: boolean) => {
    toggleRule.mutate(
      { ruleId, enabled },
      {
        onError: (err) =>
          addToast(t("verify.settings.toggleFailed", { error: getErrorMessage(err) }), "error"),
      },
    );
  };

  return (
    <section className={cn("flex flex-col min-h-0", className)}>
      <header className="shrink-0 px-3 py-2 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">{t("verify.settings.title")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("verify.settings.description")}</p>
        {rules && (
          <div className="mt-1.5 flex items-center gap-2 flex-wrap text-xs">
            <span className="rounded-full border border-border bg-muted px-1.5 py-px text-muted-foreground">
              {t("verify.settings.activeCount", { count: statusCounts.active })}
            </span>
            <span className="rounded-full border border-border bg-muted px-1.5 py-px text-muted-foreground">
              {t("verify.settings.disabledCount", { count: statusCounts.disabled })}
            </span>
            <span className="rounded-full border border-warning/40 bg-warning/10 px-1.5 py-px text-warning">
              {t("verify.settings.plannedCount", { count: statusCounts.planned })}
            </span>
          </div>
        )}
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {isLoading && (
          <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {t("verify.report.scanning")}
          </p>
        )}

        {error !== null && error !== undefined && (
          <p className="px-3 py-2 text-xs text-danger">
            {t("verify.settings.loadFailed", { error: getErrorMessage(error) })}
          </p>
        )}

        {groups.map((group) => (
          <section key={group.id}>
            <h3 className="px-3 py-1.5 bg-muted border-y border-border">
              <span className="block text-xs font-semibold text-foreground">
                {t(group.titleKey)}
              </span>
              <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                {t(group.subtitleKey)}
              </span>
            </h3>
            <ul>
              {group.rules.map((rule) => (
                <RuleRow
                  key={rule.ruleId}
                  rule={rule}
                  onToggle={handleToggle}
                  isPending={toggleRule.isPending}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}

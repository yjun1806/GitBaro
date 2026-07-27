import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { EyeOff } from "lucide-react";
import type { ScanLimit } from "@/types";
import { cn } from "@/lib/utils";
import { partialRuleIds, scopeCounts } from "./scan-scope";
import { ScanScopePopover } from "./ScanScopePopover";

export interface UncheckedSummaryProps {
  /** `VerificationReport.checked` — needed to spot partially scanned rules. */
  checked: string[];
  /** `VerificationReport.unchecked`. */
  unchecked: string[];
  /** `VerificationReport.limits` — the reason each rule was skipped. */
  limits: ScanLimit[];
  className?: string;
}

/**
 * Coverage in one row: how many rules ran, how many did not, how many ran only
 * in part.
 *
 * Required by spec §7-①, so it renders **even when nothing was skipped** — an
 * empty finding list must never be the only thing on screen. The per-rule
 * breakdown moved behind `ScanScopePopover`: this line is a scope statement,
 * not a warning, so it no longer wears warning colours or a card.
 */
export function UncheckedSummary({ checked, unchecked, limits, className }: UncheckedSummaryProps) {
  const { t } = useTranslation();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [scopeAt, setScopeAt] = useState<{ x: number; y: number } | null>(null);

  const counts = useMemo(() => scopeCounts({ checked, unchecked }), [checked, unchecked]);
  const partialCount = useMemo(
    () => partialRuleIds(checked, unchecked).length,
    [checked, unchecked],
  );

  const text = [
    t("verify.scope.summary", {
      checked: counts.fullyChecked + counts.partial,
      unchecked: counts.unchecked,
    }),
    ...(partialCount > 0 ? [t("verify.scope.partialCount", { count: partialCount })] : []),
  ].join(" · ");

  // Open only. The popover closes itself on an outside click or Escape, and
  // that outside click lands first — so a toggle here would close then reopen.
  const handleOpenScope = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setScopeAt({ x: rect.left, y: rect.bottom + 4 });
  };

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <EyeOff className="w-3 h-3 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={text}>
        {text}
      </span>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleOpenScope}
        aria-expanded={scopeAt !== null}
        className="shrink-0 text-xs text-primary hover:underline"
      >
        {t("verify.digest.scopeOpen")}
      </button>

      {scopeAt !== null && (
        <ScanScopePopover limits={limits} position={scopeAt} onClose={() => setScopeAt(null)} />
      )}
    </div>
  );
}

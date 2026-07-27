import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import type { ScanLimit, UncheckedReason } from "@/types";
import { useVerifyRules } from "@/api/queries";
import { cn } from "@/lib/utils";
import { countRuleStatuses } from "./rules";
import { groupLimitsByReason } from "./scan-scope";

interface ReasonGroupProps {
  reason: UncheckedReason;
  limits: ScanLimit[];
}

function ReasonGroup({ reason, limits }: ReasonGroupProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <li className="border-t border-border/60 first:border-t-0">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left hover:bg-accent"
      >
        <ChevronDown
          className={cn(
            "w-3 h-3 shrink-0 text-muted-foreground transition-transform",
            !isOpen && "-rotate-90",
          )}
        />
        <span className="text-xs text-foreground">{t(`verify.unchecked.${reason}`)}</span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">{limits.length}</span>
      </button>

      {isOpen && (
        <ul className="pb-1.5 pl-6 pr-2">
          {limits.map((limit) => (
            <li key={limit.ruleId} className="py-0.5">
              <span className="text-xs text-foreground">
                {t(`verify.rule.${limit.ruleId}.title`, { defaultValue: limit.ruleId })}
              </span>
              {limit.detail !== null && (
                <p className="text-xs text-muted-foreground break-words">
                  {t(`verify.scanScope.detail.${limit.detail}`, { defaultValue: limit.detail })}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export interface ScanScopePopoverProps {
  /**
   * Why each rule was skipped in one particular scan. Omit when the popover is
   * opened from a place with no single report in view (the history digest) —
   * the registry counts below still answer "what could have run at all".
   */
  limits?: ScanLimit[];
  /**
   * Viewport coordinates of the trigger's bottom-left, as `ContextMenu` takes
   * them. Pass these when the trigger sits near a clipping edge (the commit box
   * at the bottom of the sidebar); omit them to hang off the nearest
   * `relative` ancestor instead.
   */
  position?: { x: number; y: number };
  onClose: () => void;
}

/**
 * The full "what did and did not run" list, moved off the always-visible
 * surfaces and behind one affordance.
 *
 * It states the registry configuration (on / off / not implemented) even with
 * no report, because the honest floor is that a rule the user switched off is
 * not checked — and that is a property of the settings, not of the commit.
 */
export function ScanScopePopover({ limits, position, onClose }: ScanScopePopoverProps) {
  const { t } = useTranslation();
  const { data: rules = [] } = useVerifyRules();
  const containerRef = useRef<HTMLDivElement>(null);

  const statusCounts = useMemo(() => countRuleStatuses(rules), [rules]);
  const groups = useMemo(() => groupLimitsByReason(limits ?? []), [limits]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  // Same flip-into-viewport pass `ContextMenu` uses: the trigger can sit at the
  // bottom of the sidebar as easily as at the top of the history pane.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !position) return;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth) el.style.left = `${position.x - rect.width}px`;
    if (rect.bottom > window.innerHeight) el.style.top = `${position.y - rect.height}px`;
  }, [position]);

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label={t("verify.scope.label")}
      style={position ? { left: position.x, top: position.y } : undefined}
      className={cn(
        "z-[100] w-72 max-h-80 overflow-y-auto",
        "rounded-md border border-border bg-popover shadow-lg",
        position ? "fixed" : "absolute right-0 top-full mt-1",
      )}
    >
      <header className="border-b border-border px-2 py-1.5">
        <h3 className="text-xs font-semibold text-foreground">{t("verify.scope.label")}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {[
            t("verify.settings.activeCount", { count: statusCounts.active }),
            t("verify.settings.disabledCount", { count: statusCounts.disabled }),
            t("verify.settings.plannedCount", { count: statusCounts.planned }),
          ].join(" · ")}
        </p>
      </header>

      {groups.length > 0 && (
        <>
          <p className="px-2 py-1.5 text-xs text-muted-foreground">{t("verify.scope.why")}</p>
          <ul className="border-t border-border">
            {groups.map((group) => (
              <ReasonGroup key={group.reason} reason={group.reason} limits={group.limits} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

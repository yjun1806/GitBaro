import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DisclosureProps {
  /**
   * The always-visible line. It must carry the actionable content — severity,
   * counts, the top reason — because for most of the app's life this is the
   * only thing the user sees of this surface.
   */
  summary: ReactNode;
  children: ReactNode;
  /** Collapsed unless the caller has a reason to open it. */
  defaultOpen?: boolean;
  /**
   * Rendered next to the toggle but outside its `<button>`, so a surface can
   * keep its own controls (rescan, run) clickable without nesting buttons.
   */
  trailing?: ReactNode;
  /** Tooltip on the toggle row — the home for detail that lost its own line. */
  title?: string;
  className?: string;
  /** Padding/background of the always-visible row. */
  summaryClassName?: string;
  /** Sizing/scrolling of the expanded body. */
  bodyClassName?: string;
}

/**
 * One collapsed line that expands on demand.
 *
 * The body is only mounted while open, so a panel that fetches on mount costs
 * nothing until someone asks for it.
 */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  trailing,
  title,
  className,
  summaryClassName,
  bodyClassName,
}: DisclosureProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={cn("flex flex-col min-h-0", className)}>
      <div className={cn("flex shrink-0 items-center gap-2", summaryClassName)}>
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          aria-expanded={isOpen}
          title={title}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <ChevronDown
            className={cn(
              "w-3 h-3 shrink-0 text-muted-foreground transition-transform",
              !isOpen && "-rotate-90",
            )}
          />
          <span className="min-w-0 flex-1">{summary}</span>
        </button>
        {trailing}
      </div>

      {isOpen && <div className={cn("min-h-0", bodyClassName)}>{children}</div>}
    </div>
  );
}

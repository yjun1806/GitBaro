import { Search, X } from "lucide-react";
import type { ReactNode } from "react";

export interface PanelHeaderProps {
  /** Heading id — pass the same id as the panel's `aria-labelledby`. */
  titleId: string;
  title: string;
  /** Small text next to the title (e.g. the repo name). */
  subtitle?: string;
  primaryLabel?: string;
  onPrimary?: () => void;
  closeLabel: string;
  onClose: () => void;
}

/**
 * Panel chrome shared by `BranchPanel` (시안 D6) and the unified worktree
 * panel (W-Top-T1): title + repo name, a primary "new" action, and a close
 * button. Keeping this in one place is what makes the two panels read as the
 * same kind of thing instead of visually drifting apart over time.
 */
export function PanelHeader({
  titleId,
  title,
  subtitle,
  primaryLabel,
  onPrimary,
  closeLabel,
  onClose,
}: PanelHeaderProps) {
  return (
    <div className="flex items-center gap-2 px-3.5 py-3 border-b border-(--line) shrink-0">
      <strong id={titleId} className="text-sm text-(--fg)">
        {title}
      </strong>
      {subtitle && <span className="text-xs text-(--faint) truncate min-w-0">{subtitle}</span>}
      <span className="flex-1" />
      {primaryLabel && onPrimary && (
        <button
          type="button"
          onClick={onPrimary}
          className="h-[26px] px-2.5 rounded-[7px] bg-primary text-primary-foreground text-xs font-bold hover:bg-primary-hover transition-colors shrink-0"
        >
          {primaryLabel}
        </button>
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
        className="w-[26px] h-[26px] flex items-center justify-center rounded-[7px] text-(--muted) hover:bg-accent transition-colors shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export interface PanelSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoFocus?: boolean;
}

/** Search row shared by the same two panels, right under `PanelHeader`. */
export function PanelSearch({ value, onChange, placeholder, autoFocus = true }: PanelSearchProps) {
  return (
    <label className="mx-3.5 my-2.5 flex items-center gap-2 h-[30px] px-2.5 rounded-(--radius-item) bg-(--chip) shrink-0">
      <Search className="w-[13px] h-[13px] text-(--faint) shrink-0" aria-hidden="true" />
      <input
        autoFocus={autoFocus}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="flex-1 min-w-0 bg-transparent outline-none text-[12.5px] placeholder:text-(--faint)"
      />
    </label>
  );
}

export interface PanelSectionHeaderProps {
  title: string;
  count?: number;
  collapsed?: boolean;
  onToggle?: () => void;
  expandLabel?: string;
  collapseLabel?: string;
  trailing?: ReactNode;
}

/** Section header shared by both panels' sections (시안 D6 `bsec` + branchPanel's collapsible header). */
export function PanelSectionHeader({
  title,
  count,
  collapsed = false,
  onToggle,
  expandLabel,
  collapseLabel,
  trailing,
}: PanelSectionHeaderProps) {
  const heading = (
    <>
      {title}
      {collapsed && count != null && <span className="font-medium text-(--faint) tabular-nums">{count}</span>}
    </>
  );
  return (
    <h3 className="flex items-center gap-1 pl-2 pr-3.5 pt-1.5 pb-0.5 text-[11px] font-bold text-(--muted) bg-(--acc-faint) border-b border-(--line)">
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? expandLabel : collapseLabel}
          className="flex items-center gap-1 h-6 px-1.5 rounded-[6px] hover:bg-accent transition-colors"
        >
          {heading}
        </button>
      ) : (
        <span className="flex items-center gap-1 h-6 px-1.5">{heading}</span>
      )}
      <span className="flex-1" />
      {trailing}
    </h3>
  );
}

export interface PanelEmptyStateProps {
  message: string;
}

/** Empty/no-match state shared by both panels' lists. */
export function PanelEmptyState({ message }: PanelEmptyStateProps) {
  return <p className="px-4 py-6 text-center text-sm text-muted-foreground">{message}</p>;
}

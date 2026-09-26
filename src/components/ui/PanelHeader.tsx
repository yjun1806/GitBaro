import type { ReactNode } from "react";
import { ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";
import { SearchInput } from "./TextInput";
import { Count } from "./marks";
import { EmptyState } from "./EmptyState";

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
 * Panel chrome shared by `BranchPanel`(시안 D6) and the unified worktree
 * panel(W-Top-T1): title + repo name, a primary "new" action, and a close
 * button.
 */
export function PanelHeader({ titleId, title, subtitle, primaryLabel, onPrimary, closeLabel, onClose }: PanelHeaderProps) {
  return (
    <div className="flex items-center gap-2 px-3.5 py-3 border-b border-(--line) shrink-0">
      <strong id={titleId} className="text-[14px] font-semibold text-(--fg)">
        {title}
      </strong>
      {subtitle && <span className="text-[11.5px] text-muted-foreground truncate min-w-0">{subtitle}</span>}
      <span className="flex-1" />
      {primaryLabel && onPrimary && (
        <Button variant="primary" size="md" onClick={onPrimary}>
          {primaryLabel}
        </Button>
      )}
      <Button iconOnly size="md" variant="ghost" onClick={onClose} aria-label={closeLabel} title={closeLabel}>
        <X className="w-4 h-4" />
      </Button>
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
    <div className="mx-3.5 my-2.5 shrink-0">
      <SearchInput
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        size="md"
      />
    </div>
  );
}

export interface SectionLabelProps {
  title: string;
  /** 다른 요소가 `aria-labelledby`로 가리킬 id. */
  id?: string;
  count?: number;
  collapsed?: boolean;
  onToggle?: () => void;
  expandLabel?: string;
  collapseLabel?: string;
  trailing?: ReactNode;
  /** 패널 안 구역·저장소별 그룹 머리에 쓰는 띠 변형: 옅은 브랜드 채움 + 아래 테두리. */
  banner?: boolean;
  className?: string;
}

/** 구역 라벨(3.5). 접는 것이면 ▾ + `aria-expanded`, 접혔을 때만 수를 보인다. */
export function SectionLabel({
  title,
  id,
  count,
  collapsed = false,
  onToggle,
  expandLabel,
  collapseLabel,
  trailing,
  banner = false,
  className,
}: SectionLabelProps) {
  const heading = (
    <>
      {onToggle && (
        <ChevronDown
          aria-hidden="true"
          data-testid="section-label-chevron"
          className={cn(
            "w-2.5 h-2.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
            collapsed && "-rotate-90",
          )}
          strokeWidth={2.6}
        />
      )}
      <span className="truncate">{title}</span>
      {collapsed && count != null && <Count value={count} tone="muted" />}
    </>
  );
  return (
    <h3
      id={id}
      className={cn(
        "flex items-center gap-1.5 pl-2 pr-3.5 pt-1.5 pb-0.5 text-[11.5px] font-semibold text-muted-foreground",
        banner && "bg-(--acc-faint) border-b border-(--line)",
        className,
      )}
    >
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? expandLabel : collapseLabel}
          className="flex items-center gap-1.5 min-w-0 h-6 px-1.5 rounded-(--radius-chip) hover:bg-accent transition-colors motion-reduce:transition-none"
        >
          {heading}
        </button>
      ) : (
        <span className="flex items-center gap-1.5 min-w-0 h-6 px-1.5">{heading}</span>
      )}
      <span className="flex-1" />
      {trailing}
    </h3>
  );
}

/** @deprecated `SectionLabel`로 이름을 바꿨다. */
export const PanelSectionHeader = SectionLabel;
/** @deprecated `SectionLabel`로 이름을 바꿨다. */
export type PanelSectionHeaderProps = SectionLabelProps;

export interface PanelEmptyStateProps {
  message: string;
}

/** @deprecated `EmptyState layout="row"`를 쓴다. */
export function PanelEmptyState({ message }: PanelEmptyStateProps) {
  return <EmptyState layout="row" title={message} />;
}

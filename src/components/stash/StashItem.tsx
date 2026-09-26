import { cn, formatRelativeTime } from "@/lib/utils";
import { RefLabel } from "@/components/ui/marks";
import type { StashEntry } from "@/types";

interface StashItemProps {
  entry: StashEntry;
  isSelected?: boolean;
  isHighlighted?: boolean;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  ref?: React.Ref<HTMLButtonElement>;
}

/** Extract a short summary from a stash message (mirrors Rust stash_short_message). */
function shortMessage(message: string): string {
  const colonIdx = message.indexOf(": ");
  if (colonIdx === -1) return message;
  const after = message.slice(colonIdx + 2);
  if (after.length > 8 && /^[0-9a-f]{7} /.test(after)) {
    return after.slice(8);
  }
  return after;
}

export function StashItem({
  entry,
  isSelected,
  isHighlighted,
  onClick,
  onContextMenu,
  ref,
}: StashItemProps) {
  return (
    <button
      ref={ref}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cn(
        "w-full flex items-center gap-3 min-h-11 px-3 text-left transition-colors border-b border-(--line) select-none",
        isSelected
          ? "bg-(--acc-sel) font-semibold"
          : !isSelected && isHighlighted
            ? "bg-accent ring-1 ring-inset ring-primary/30"
            : "hover:bg-accent",
      )}
    >
      <div className="flex-1 min-w-0 py-1.5">
        <p className="text-[12.5px] font-semibold truncate">
          {shortMessage(entry.message)}
        </p>
        <div className="flex items-center gap-1 mt-0.5">
          <span className="text-[11.5px] text-muted-foreground shrink-0">
            stash@{"{"}
            {entry.index}
            {"}"}
          </span>
          {entry.branchName && <RefLabel name={entry.branchName} kind="local" className="max-w-[140px]" />}
          <span className="text-[11.5px] text-muted-foreground shrink-0">{"\u00B7"}</span>
          <span className="text-[11.5px] text-muted-foreground shrink-0">
            {formatRelativeTime(entry.timestamp)}
          </span>
        </div>
      </div>
    </button>
  );
}

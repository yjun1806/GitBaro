import { cn, formatRelativeTime } from "@/lib/utils";
import type { StashEntry } from "@/types";

interface StashItemProps {
  entry: StashEntry;
  isSelected?: boolean;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
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
  onClick,
  onContextMenu,
}: StashItemProps) {
  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors border-b border-border select-none",
        isSelected
          ? "bg-primary/10 text-primary font-semibold"
          : "hover:bg-accent",
      )}
    >
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">
          {shortMessage(entry.message)}
        </p>
        <div className="flex items-center gap-1 mt-0.5">
          <span
            className={cn(
              "text-[10px] px-1.5 py-0.5 rounded-full",
              isSelected
                ? "bg-primary/20 text-primary"
                : "bg-muted text-muted-foreground",
            )}
          >
            stash@{"{"}
            {entry.index}
            {"}"}
          </span>
          {entry.branchName && (
            <span
              className={cn(
                "text-xs truncate",
                isSelected ? "text-primary/70" : "text-muted-foreground",
              )}
            >
              {entry.branchName}
            </span>
          )}
          <span
            className={cn(
              "text-xs shrink-0",
              isSelected ? "text-primary/50" : "text-muted-foreground",
            )}
          >
            {"\u00B7"}
          </span>
          <span
            className={cn(
              "text-xs shrink-0",
              isSelected ? "text-primary/70" : "text-muted-foreground",
            )}
          >
            {formatRelativeTime(entry.timestamp)}
          </span>
        </div>
      </div>
    </button>
  );
}

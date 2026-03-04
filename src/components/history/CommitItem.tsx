import type { ReactNode } from "react";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { CommitInfo } from "@/types";

interface CommitItemProps {
  commit: CommitInfo;
  isSelected?: boolean;
  isHighlighted?: boolean;
  avatarUrl?: string;
  trailing?: ReactNode;
  onClick?: () => void;
  ref?: React.Ref<HTMLButtonElement>;
}

export function CommitItem({
  commit,
  isSelected,
  isHighlighted,
  avatarUrl,
  trailing,
  onClick,
  ref,
}: CommitItemProps) {
  const resolvedAvatar = avatarUrl ?? commit.author.avatarUrl;

  return (
    <button
      ref={ref}
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors border-b border-border select-none",
        isSelected
          ? "bg-primary/10 text-primary font-semibold"
          : !isSelected && isHighlighted
            ? "bg-accent ring-1 ring-primary/30"
            : "hover:bg-accent",
      )}
    >
      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{commit.summary}</p>
        <div className="flex items-center gap-1 mt-0.5">
          {/* Avatar */}
          {resolvedAvatar ? (
            <img
              src={resolvedAvatar}
              alt={commit.author.name ?? ""}
              className="w-3.5 h-3.5 rounded-full shrink-0 object-cover"
            />
          ) : (
            <div
              className={cn(
                "w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0",
                "text-[8px] font-bold",
                isSelected
                  ? "bg-primary/20 text-primary"
                  : "bg-primary/10 text-primary",
              )}
            >
              {(commit.author.name ?? "?")[0].toUpperCase()}
            </div>
          )}
          <span
            className={cn(
              "text-xs truncate",
              isSelected ? "text-primary/70" : "text-muted-foreground",
            )}
          >
            {commit.author.name}
          </span>
          <span
            className={cn(
              "text-xs shrink-0 leading-none",
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
            {formatRelativeTime(commit.timestamp)}
          </span>
        </div>
      </div>

      {/* Trailing slot (e.g. unpushed badge) */}
      {trailing}
    </button>
  );
}

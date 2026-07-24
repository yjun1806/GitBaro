import type { ReactNode } from "react";
import { Tag, GitBranch } from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { CommitInfo, RefLabel } from "@/types";

function RefBadge({
  label,
  remoteTags,
}: {
  label: RefLabel;
  remoteTags?: Set<string> | null;
}) {
  const isRemote = label.kind === "remoteBranch";
  const isTag = label.kind === "tag";
  // A tag is local-only when origin's tag list is known and doesn't contain it.
  const isLocalOnlyTag = isTag && remoteTags != null && !remoteTags.has(label.name);
  // Two orthogonal signals (the palette is monochrome, so color can't carry
  // location — form does):
  //   Type     → color: branches read neutral (gray), tags read green (accent).
  //   Location → form: local/unpushed refs are outlined (local-only tags dashed),
  //              on-remote refs are filled. HEAD is the one emphasised ref.
  const TypeIcon = isTag ? Tag : GitBranch;
  return (
    <span
      title={isLocalOnlyTag ? `${label.name} (local only)` : undefined}
      className={cn(
        "inline-flex items-center gap-0.5 max-w-[140px] rounded px-1 py-px text-[10px] font-medium leading-none border",
        label.isHead
          ? // HEAD ("you are here"): solid primary fill, strongest emphasis.
            "bg-primary text-primary-foreground border-primary font-semibold"
          : isLocalOnlyTag
            ? // Local-only tag: green, outlined + dashed = "not yet pushed".
              "bg-transparent text-success border-success/45 border-dashed"
            : isTag
              ? // Pushed tag: green, soft-filled.
                "bg-success/10 text-success border-success/45"
              : isRemote
                ? // Remote branch: neutral, outlined.
                  "bg-transparent text-muted-foreground border-border"
                : // Local branch: neutral, filled.
                  "bg-muted text-foreground border-border",
      )}
    >
      <TypeIcon className="w-2.5 h-2.5 shrink-0" />
      <span className="truncate">{label.name}</span>
    </span>
  );
}

interface CommitItemProps {
  commit: CommitInfo;
  remoteTags?: Set<string> | null;
  isSelected?: boolean;
  isHighlighted?: boolean;
  avatarUrl?: string;
  trailing?: ReactNode;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  ref?: React.Ref<HTMLButtonElement>;
}

export function CommitItem({
  commit,
  remoteTags,
  isSelected,
  isHighlighted,
  avatarUrl,
  trailing,
  onClick,
  onContextMenu,
  ref,
}: CommitItemProps) {
  const resolvedAvatar = avatarUrl ?? commit.author.avatarUrl;

  return (
    <button
      ref={ref}
      onClick={onClick}
      onContextMenu={onContextMenu}
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
        {commit.refs.length > 0 && (
          <div className="flex items-center gap-1 mb-1 flex-wrap">
            {commit.refs.map((label) => (
              <RefBadge
                key={`${label.kind}:${label.name}`}
                label={label}
                remoteTags={remoteTags}
              />
            ))}
          </div>
        )}
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

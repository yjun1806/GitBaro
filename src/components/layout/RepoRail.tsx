import { useState, useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  PanelLeft,
  Loader2,
  ListTree,
  Check,
  Star,
  HardDrive,
  Building2,
  User,
  Globe,
} from "lucide-react";
import { useUIStore, type RailMode } from "@/stores/ui";
import { useRepositoryStore } from "@/stores/repository";
import { useAccountStore } from "@/stores/account";
import { useSelectRepo } from "@/hooks/useSelectRepo";
import { useRepoSyncStatuses } from "@/api/queries";
import { RepoSyncIndicator } from "@/components/repository/RepoSyncIndicator";
import { avatarColor, avatarInitial } from "@/lib/avatar-color";
import { groupReposByOwner, type GroupedRepos } from "@/lib/group-repos";
import { cn } from "@/lib/utils";
import type { RepoInfo, RepoSyncStatus } from "@/types";

export const RAIL_COLLAPSED_WIDTH = 56;
export const RAIL_EXPANDED_WIDTH = 220;
const COLLAPSED_WIDTH = RAIL_COLLAPSED_WIDTH;
const EXPANDED_WIDTH = RAIL_EXPANDED_WIDTH;

// rail이 flex 흐름에서 실제로 차지하는 가로 폭 (hover 모드는 확장 패널이 절대배치로
// 떠서 흐름 폭은 collapsed와 같다). sidebar 오른쪽에 붙는 fixed 패널의 left 계산에 사용.
export function railFlowWidth(railMode: RailMode): number {
  return railMode === "expanded" ? RAIL_EXPANDED_WIDTH : RAIL_COLLAPSED_WIDTH;
}

/* ─── Sidebar control popover (Expanded / Collapsed / Expand on hover) ─── */

function SidebarControl({ expanded }: { expanded: boolean }) {
  const { t } = useTranslation();
  const railMode = useUIStore((s) => s.railMode);
  const setRailMode = useUIStore((s) => s.setRailMode);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const modes: { mode: RailMode; label: string }[] = [
    { mode: "expanded", label: t("rail.expanded") },
    { mode: "collapsed", label: t("rail.collapsed") },
    { mode: "hover", label: t("rail.expandOnHover") },
  ];

  return (
    <div ref={ref} className="relative shrink-0 border-t border-border p-2 flex justify-center">
      <button
        onClick={() => setOpen((v) => !v)}
        title={t("rail.sidebarControl")}
        className={cn(
          "flex items-center gap-2 h-8 rounded-md hover:bg-accent transition-colors text-muted-foreground",
          expanded ? "w-full px-2.5" : "w-8 justify-center",
        )}
      >
        <PanelLeft className="w-4 h-4 shrink-0" />
        {expanded && (
          <span className="text-xs truncate">{t("rail.sidebarControl")}</span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-2 mb-1 w-56 bg-popover border border-border rounded-lg shadow-lg z-50 py-1">
          <p className="px-3 py-1.5 text-xs font-semibold text-muted-foreground border-b border-border">
            {t("rail.sidebarControl")}
          </p>
          {modes.map(({ mode, label }) => (
            <button
              key={mode}
              onClick={() => {
                setRailMode(mode);
                setOpen(false);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-accent transition-colors text-left"
            >
              <span className="w-4 shrink-0 flex items-center justify-center">
                {railMode === mode && <Check className="w-3.5 h-3.5 text-primary" />}
              </span>
              <span className={cn(railMode === mode && "text-primary font-medium")}>
                {label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Group header (expanded) / divider (collapsed) ─── */

function groupIcon(label: string, favLabel: string, ownerType?: "User" | "Organization") {
  if (label === favLabel) return Star;
  if (label === "Local") return HardDrive;
  if (ownerType === "Organization") return Building2;
  if (ownerType === "User") return User;
  return Globe;
}

function RailGroupHeader({
  group,
  favLabel,
  ownerType,
}: {
  group: GroupedRepos;
  favLabel: string;
  ownerType?: "User" | "Organization";
}) {
  const isFav = group.label === favLabel;
  const Icon = groupIcon(group.label, favLabel, ownerType);
  return (
    <div className="flex items-center gap-1.5 px-2 h-6">
      <Icon
        className={cn(
          "w-3 h-3 shrink-0",
          isFav ? "text-warning fill-warning" : "text-muted-foreground",
        )}
      />
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground truncate">
        {group.label}
      </span>
      <span className="text-[10px] text-muted-foreground/50 tabular-nums ml-auto">
        {group.repos.length}
      </span>
    </div>
  );
}

/** 접힘 상태의 그룹 마커 — 어떤 그룹인지 이니셜/아이콘으로 힌트를 준다. */
function RailGroupMarker({
  group,
  favLabel,
  showDivider,
}: {
  group: GroupedRepos;
  favLabel: string;
  showDivider: boolean;
}) {
  const isFav = group.label === favLabel;
  return (
    <div className="flex flex-col items-center gap-1 py-0.5" title={group.label}>
      {showDivider && <div className="h-px w-6 bg-border/60 mb-0.5" />}
      {isFav ? (
        <Star className="w-3.5 h-3.5 text-warning fill-warning" />
      ) : group.label === "Local" ? (
        <HardDrive className="w-3.5 h-3.5 text-muted-foreground/70" />
      ) : (
        <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground/70 leading-none">
          {group.label.slice(0, 2)}
        </span>
      )}
    </div>
  );
}

/* ─── Rail repo item ─── */

function RailItem({
  repo,
  isActive,
  isFetching,
  expanded,
  syncStatus,
  onSelect,
  onHoverStart,
  onHoverEnd,
}: {
  repo: RepoInfo;
  isActive: boolean;
  isFetching: boolean;
  expanded: boolean;
  syncStatus?: RepoSyncStatus;
  onSelect: () => void;
  onHoverStart?: (name: string, rect: DOMRect) => void;
  onHoverEnd?: () => void;
}) {
  const { t } = useTranslation();
  const color = avatarColor(repo.path);
  const initial = avatarInitial(repo.name);

  return (
    <button
      onClick={onSelect}
      title={expanded ? repo.name : undefined}
      onMouseEnter={
        onHoverStart
          ? (e) => onHoverStart(repo.name, e.currentTarget.getBoundingClientRect())
          : undefined
      }
      onMouseLeave={onHoverEnd}
      className={cn(
        "relative flex items-center gap-2.5 h-10 rounded-lg transition-colors shrink-0",
        expanded ? "w-full px-2.5" : "w-11 justify-center mx-auto",
        isActive ? "bg-primary/10" : "hover:bg-accent",
      )}
    >
      {/* Active accent bar */}
      {isActive && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-primary" />
      )}
      <span className="relative shrink-0">
        <span
          className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-semibold"
          style={{ backgroundColor: color.background, color: color.foreground }}
        >
          {initial}
        </span>
        {/* Collapsed 모드는 이름/카운트 공간이 없어 아바타 코너에 점만 표시:
            우상단 = push/pull 상태, 우하단 = 커밋되지 않은 변경 */}
        {!expanded && (
          <RepoSyncIndicator
            status={syncStatus}
            variant="dot"
            className="absolute -top-0.5 -right-0.5 ring-2 ring-surface"
          />
        )}
        {!expanded && syncStatus?.isDirty && (
          <span
            className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-warning ring-2 ring-surface"
            title={t("repo.uncommittedChanges")}
          />
        )}
      </span>

      {expanded && (
        <span
          className={cn(
            "flex-1 min-w-0 text-sm truncate text-left",
            isActive ? "text-primary font-semibold" : "text-foreground",
          )}
        >
          {repo.name}
        </span>
      )}

      {expanded && (
        <span className="flex items-center gap-1.5 shrink-0">
          {syncStatus?.isDirty && (
            <span
              className="w-2 h-2 rounded-full bg-warning shrink-0"
              title={t("repo.uncommittedChanges")}
            />
          )}
          {isFetching ? (
            <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
          ) : (
            <RepoSyncIndicator status={syncStatus} variant="badge" />
          )}
        </span>
      )}
    </button>
  );
}

/* ─── RepoRail ─── */

export function RepoRail() {
  const { t } = useTranslation();
  const railMode = useUIStore((s) => s.railMode);
  const setRepoListOpen = useUIStore((s) => s.setRepoListOpen);
  const repos = useRepositoryStore((s) => s.repos);
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const favoriteRepos = useRepositoryStore((s) => s.favoriteRepos);
  const ownerTypes = useRepositoryStore((s) => s.ownerTypes);
  const accounts = useAccountStore((s) => s.accounts);
  const repoPaths = useMemo(() => repos.map((r) => r.path), [repos]);
  const { data: syncMap } = useRepoSyncStatuses(repoPaths);
  const { selectRepo, fetchingPath } = useSelectRepo();
  const [hovered, setHovered] = useState(false);
  const [tip, setTip] = useState<{ name: string; y: number } | null>(null);

  const isExpanded = railMode === "expanded" || (railMode === "hover" && hovered);
  const flowWidth = railMode === "expanded" ? EXPANDED_WIDTH : COLLAPSED_WIDTH;
  const panelWidth = isExpanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH;
  const isOverlay = railMode === "hover" && hovered;

  const favLabel = t("repo.favorites");

  // Collapsed mode has no room for names — show a hover tooltip so repos with
  // the same initial can be told apart. Rendered `fixed` to escape the list's
  // horizontal overflow clipping.
  const showTip = railMode === "collapsed";
  const handleHoverStart = showTip
    ? (name: string, rect: DOMRect) => setTip({ name, y: rect.top + rect.height / 2 })
    : undefined;
  const handleHoverEnd = showTip ? () => setTip(null) : undefined;

  // Favorites group first, then owner groups — same structure as the full repo list.
  const groups = useMemo<GroupedRepos[]>(() => {
    const favSet = new Set(favoriteRepos);
    const favRepos = repos.filter((r) => favSet.has(r.path));
    const nonFav = repos.filter((r) => !favSet.has(r.path));
    const ownerGroups = groupReposByOwner(nonFav, accounts);
    return favRepos.length > 0
      ? [{ label: favLabel, repos: favRepos }, ...ownerGroups]
      : ownerGroups;
  }, [repos, favoriteRepos, accounts, favLabel]);

  return (
    <div className="relative shrink-0 h-full" style={{ width: flowWidth }}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ width: panelWidth }}
        className={cn(
          "absolute inset-y-0 left-0 flex flex-col bg-surface border-r border-border transition-[width] duration-150 z-30",
          isOverlay && "shadow-xl",
        )}
      >
        {/* Manage / all repositories */}
        <button
          onClick={() => setRepoListOpen(true)}
          title={t("rail.allRepos")}
          className={cn(
            "flex items-center gap-2.5 h-11 shrink-0 border-b border-border hover:bg-accent transition-colors text-muted-foreground",
            isExpanded ? "px-4" : "justify-center",
          )}
        >
          <ListTree className="w-4 h-4 shrink-0" />
          {isExpanded && (
            <span className="text-xs font-semibold uppercase tracking-wider truncate">
              {t("rail.repositories")}
            </span>
          )}
        </button>

        {/* Grouped repo list */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden py-2 px-1.5">
          {groups.map((group, gi) => (
            <div
              key={group.label}
              className={cn("flex flex-col gap-1", gi > 0 && (isExpanded ? "mt-2" : "mt-1"))}
            >
              {isExpanded ? (
                <RailGroupHeader
                  group={group}
                  favLabel={favLabel}
                  ownerType={ownerTypes[group.label]}
                />
              ) : (
                <RailGroupMarker group={group} favLabel={favLabel} showDivider={gi > 0} />
              )}
              {group.repos.map((repo) => (
                <RailItem
                  key={repo.path}
                  repo={repo}
                  isActive={repo.path === activeRepoPath}
                  isFetching={fetchingPath === repo.path}
                  expanded={isExpanded}
                  syncStatus={syncMap?.[repo.path]}
                  onSelect={() => selectRepo(repo.path)}
                  onHoverStart={handleHoverStart}
                  onHoverEnd={handleHoverEnd}
                />
              ))}
            </div>
          ))}
        </div>

        {/* Sidebar control */}
        <SidebarControl expanded={isExpanded} />
      </div>

      {/* Hover tooltip (collapsed mode) — fixed to escape overflow clipping */}
      {tip && (
        <div
          className="fixed z-50 pointer-events-none px-2 py-1 rounded-md bg-popover border border-border text-xs whitespace-nowrap shadow-md"
          style={{ left: COLLAPSED_WIDTH + 8, top: tip.y, transform: "translateY(-50%)" }}
        >
          {tip.name}
        </div>
      )}
    </div>
  );
}

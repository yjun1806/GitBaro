import { useState, useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { PanelLeft, Loader2, ListTree, Check, HardDrive } from "lucide-react";
import { useUIStore, type RailMode } from "@/stores/ui";
import { useRepositoryStore, useRepoViewPath } from "@/stores/repository";
import { useSelectRepo } from "@/hooks/useSelectRepo";
import { useSettings } from "@/api/queries";
import { RepoSyncIndicator } from "@/components/repository/RepoSyncIndicator";
import { RepoHeaderContextMenu } from "@/components/repository/RepoHeaderContextMenu";
import { RepoTree } from "@/components/sidebar/RepoTree";
import {
  allWorktreePaths,
  SIDEBAR_FALLBACK_WATCH_KEY,
  useSidebarTreeData,
  useSidebarWatchPaths,
} from "@/components/sidebar/useSidebarTreeData";
import { avatarColor, avatarInitial } from "@/lib/avatar-color";
import { HEADER_HEIGHT_CLASS, TRAFFIC_LIGHT_INSET_PX } from "@/lib/layout-tokens";
import { cn } from "@/lib/utils";
import { FLOATING_SURFACE } from "@/components/ui/layers";
import { TOOLBAR_ICON, toolbarButtonClass } from "@/components/toolbar/toolbar-button";
import type { RepoInfo, RepoSyncStatus } from "@/types";

export const RAIL_COLLAPSED_WIDTH = 56;
/** 펼친 사이드바 기본 폭. 시안 `gen_d.py`의 `sidebar()` 폭 276px. */
export const RAIL_EXPANDED_WIDTH = 276;
const COLLAPSED_WIDTH = RAIL_COLLAPSED_WIDTH;

// rail이 flex 흐름에서 실제로 차지하는 가로 폭 (hover 모드는 확장 패널이 절대배치로
// 떠서 흐름 폭은 collapsed와 같다). sidebar 오른쪽에 붙는 fixed 패널의 left 계산에 사용.
export function railFlowWidth(railMode: RailMode, expandedWidth = RAIL_EXPANDED_WIDTH): number {
  return railMode === "expanded" ? expandedWidth : RAIL_COLLAPSED_WIDTH;
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
          "flex items-center gap-2 h-8 rounded-md hover:bg-(--frame-hover) transition-colors text-muted-foreground",
          expanded ? "w-full px-2.5" : "w-8 justify-center",
        )}
      >
        <PanelLeft className="w-4 h-4 shrink-0" />
        {expanded && (
          <span className="text-xs truncate">{t("rail.sidebarControl")}</span>
        )}
      </button>

      {open && (
        <div className={cn("absolute bottom-full left-2 mb-1 w-56 rounded-lg z-50 py-1", FLOATING_SURFACE)}>
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
                {railMode === mode && <Check className="w-3.5 h-3.5 text-foreground" />}
              </span>
              <span className={cn(railMode === mode && "text-foreground font-medium")}>
                {label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Account marker (collapsed) ─── */

/** 접힘 상태의 계정 마커 — 어떤 계정인지 이니셜/아이콘으로 힌트를 준다. */
function RailGroupMarker({ label, showDivider }: { label: string; showDivider: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1 py-0.5" title={label}>
      {showDivider && <div className="h-px w-6 bg-border/60 mb-0.5" />}
      {label === "Local" ? (
        <HardDrive className="w-3.5 h-3.5 text-muted-foreground/70" />
      ) : (
        <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground/70 leading-none">
          {label.slice(0, 2)}
        </span>
      )}
    </div>
  );
}

/* ─── Rail repo item (collapsed) ─── */

function RailItem({
  repo,
  isActive,
  isFetching,
  syncStatus,
  onSelect,
  onContextMenu,
  onHoverStart,
  onHoverEnd,
}: {
  repo: RepoInfo;
  isActive: boolean;
  isFetching: boolean;
  syncStatus?: RepoSyncStatus;
  onSelect: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onHoverStart?: (name: string, rect: DOMRect) => void;
  onHoverEnd?: () => void;
}) {
  const { t } = useTranslation();
  const color = avatarColor(repo.path);
  const initial = avatarInitial(repo.name);

  return (
    <button
      onClick={onSelect}
      onContextMenu={onContextMenu}
      aria-label={repo.name}
      onMouseEnter={
        onHoverStart
          ? (e) => onHoverStart(repo.name, e.currentTarget.getBoundingClientRect())
          : undefined
      }
      onMouseLeave={onHoverEnd}
      className={cn(
        "relative flex items-center justify-center w-11 h-10 mx-auto rounded-lg transition-colors shrink-0",
        isActive ? "bg-(--frame-sel)" : "hover:bg-(--frame-hover)",
      )}
    >
      {/* Active accent bar */}
      {isActive && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-(--acc)" />
      )}
      <span className="relative shrink-0">
        <span
          className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-semibold"
          style={{ backgroundColor: color.background, color: color.foreground }}
        >
          {initial}
        </span>
        {/* 이름/카운트 공간이 없어 아바타 코너에 점만 표시:
            우상단 = push/pull 상태, 우하단 = 커밋되지 않은 변경 */}
        {isFetching ? (
          <Loader2 className="absolute -top-1 -right-1 w-3 h-3 text-muted-foreground animate-spin" />
        ) : (
          <RepoSyncIndicator
            status={syncStatus}
            variant="dot"
            className="absolute -top-0.5 -right-0.5 ring-2 ring-(--frame)"
          />
        )}
        {syncStatus?.isDirty && (
          <span
            className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-[var(--live)] ring-2 ring-(--frame)"
            title={t("repo.uncommittedChanges")}
          />
        )}
      </span>
    </button>
  );
}

/* ─── RepoRail ─── */

interface RepoRailProps {
  /** 펼쳤을 때 폭(px). 셸이 사이드바 폭 조절을 넘겨준다. 없으면 시안 폭(276px). */
  expandedWidth?: number;
}

/**
 * 왼쪽 사이드바. 펼치면 계정 → 워크스페이스 → 저장소 → 워크트리 트리(`RepoTree`)를, 접으면 저장소
 * 아바타 줄을 보여 준다. 펼침·접힘·마우스를 올리면 펼침 세 모드는 사이드바 설정 버튼으로 고른다.
 * 맨 위 버튼은 모든 저장소 목록(`RepoListView`)을 열고 닫는다(`repoListOpen`). 목록 자체는
 * 메인 칸이 그린다(사이드바 안에 한 벌 더 그리지 않는다).
 */
export function RepoRail({ expandedWidth = RAIL_EXPANDED_WIDTH }: RepoRailProps) {
  const { t } = useTranslation();
  const railMode = useUIStore((s) => s.railMode);
  const repoListOpen = useUIStore((s) => s.repoListOpen);
  const setRepoListOpen = useUIStore((s) => s.setRepoListOpen);
  // activeRepoPath는 워크트리를 보는 중이면 워크트리 경로라 저장소와 매칭되지 않는다.
  // 소유 저장소를 담고 있는 activeRepo로 비교해야 워크트리에서도 선택 표시가 유지된다.
  const activeRepo = useRepositoryStore((s) => s.activeRepo);
  const repoViewPath = useRepoViewPath();
  const { data: settingsData = null } = useSettings();
  const removeRepo = useRepositoryStore((s) => s.removeRepo);
  const { selectRepo, fetchingPath } = useSelectRepo();
  const treeData = useSidebarTreeData();
  const [hovered, setHovered] = useState(false);
  const [tip, setTip] = useState<{ name: string; y: number } | null>(null);
  const [menu, setMenu] = useState<{ repo: RepoInfo; x: number; y: number } | null>(null);

  const isExpanded = railMode === "expanded" || (railMode === "hover" && hovered);
  const flowWidth = railFlowWidth(railMode, expandedWidth);
  const panelWidth = isExpanded ? expandedWidth : COLLAPSED_WIDTH;
  const isOverlay = railMode === "hover" && isExpanded;

  // 트리가 펼쳐져 있으면 RepoTree가 보이는 워크트리 행만 정확히 감시 등록한다
  // (SIDEBAR_WATCH_KEY). 접히거나 hover 모드에서 마우스가 떠나 있으면 RepoTree가
  // unmount돼 그 등록이 사라지므로, 다른 화면이 감시하지 않는 워크트리(저장소 옆에 따로 만든
  // 것 등)가 통째로 감시에서 빠진다. 그 사이에는 이 키로 저장소의 모든 워크트리를 대신 감시한다.
  const fallbackWatchPaths = useMemo(
    () => (isExpanded ? [] : allWorktreePaths(treeData.worktreesByRepo)),
    [isExpanded, treeData.worktreesByRepo],
  );
  useSidebarWatchPaths(fallbackWatchPaths, SIDEBAR_FALLBACK_WATCH_KEY);

  // Collapsed mode has no room for names — show a hover tooltip so repos with
  // the same initial can be told apart. Rendered `fixed` to escape the list's
  // horizontal overflow clipping.
  const showTip = railMode === "collapsed";
  const handleHoverStart = showTip
    ? (name: string, rect: DOMRect) => setTip({ name, y: rect.top + rect.height / 2 })
    : undefined;
  const handleHoverEnd = showTip ? () => setTip(null) : undefined;

  // 접힌 줄은 트리와 같은 순서로 저장소를 늘어놓는다(계정마다 마커 하나).
  const railGroups = useMemo(
    () =>
      treeData.tree.map((account) => ({
        key: account.key,
        label: account.label,
        repos: [
          ...account.children.flatMap((c) => (c.kind === "repo" ? [c.repo] : c.repos.map((r) => r.repo))),
          ...account.quietRepos.map((r) => r.repo),
        ],
      })),
    [treeData.tree],
  );

  const openMenu = (repo: RepoInfo, e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ repo, x: e.clientX, y: e.clientY });
  };

  return (
    <div className="relative shrink-0 h-full" style={{ width: flowWidth }}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ width: panelWidth }}
        className={cn(
          // 시안의 사이드바는 바탕(canvas) 위에 선 없이 놓인다. 선은 메인 칸 위에 떠서 펼쳐질 때만 긋는다.
          "absolute inset-y-0 left-0 flex flex-col bg-(--frame) transition-[width] duration-150 z-30",
          isOverlay && "border-r border-border shadow-(--shadow-float)",
        )}
      >
        {/* 사이드바 머리글 줄 — 툴바(ToolbarRoot)와 같은 높이(HEADER_HEIGHT_CLASS)라
            아래 테두리가 창 위쪽에서 하나로 이어져 보인다. macOS 트래픽 라이트는 창의
            맨 왼쪽 위, 즉 이 줄 안에 있으므로 그 자리(TRAFFIC_LIGHT_INSET_PX)는 여기서
            예약한다(Overlay 타이틀바). 접힌 사이드바는 그 폭(56px)이 트래픽 라이트보다
            좁아 예약할 자리가 없어 이 예약은 펼침(hover 포함) 상태에서만 둔다. */}
        <div className={cn("flex items-center shrink-0 border-b border-(--line2)", isExpanded ? "pr-2" : "justify-center", HEADER_HEIGHT_CLASS)}>
          {isExpanded && (
            <div className="h-full shrink-0" style={{ width: TRAFFIC_LIGHT_INSET_PX }} data-tauri-drag-region />
          )}
          <button
            onClick={() => setRepoListOpen(!repoListOpen)}
            title={t("rail.allRepos")}
            aria-pressed={repoListOpen}
            className={cn(
              toolbarButtonClass({ open: repoListOpen, iconOnly: !isExpanded }),
              isExpanded && "min-w-0 shrink justify-start",
            )}
          >
            <ListTree className={TOOLBAR_ICON} />
            {isExpanded && <span className="truncate">{t("rail.allRepos")}</span>}
          </button>
        </div>

        {isExpanded ? (
          <div className="flex-1 min-h-0 px-2.5 pt-2.5 pb-1">
            <RepoTree
              data={treeData}
              fetchingPath={fetchingPath}
              onSelectRepo={selectRepo}
              onRepoContextMenu={openMenu}
            />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto overflow-x-hidden py-2 px-1.5">
            {railGroups.map((group, gi) => (
              <div key={group.key} className={cn("flex flex-col gap-1", gi > 0 && "mt-1")}>
                <RailGroupMarker label={group.label} showDivider={gi > 0} />
                {group.repos.map((repo) => (
                  <RailItem
                    key={repo.path}
                    repo={repo}
                    isActive={repo.path === activeRepo?.path}
                    isFetching={fetchingPath === repo.path}
                    syncStatus={
                      treeData.syncByPath[repoViewPath(repo.path)] ?? treeData.syncByPath[repo.path]
                    }
                    onSelect={() => selectRepo(repo.path)}
                    onContextMenu={(e) => openMenu(repo, e)}
                    onHoverStart={handleHoverStart}
                    onHoverEnd={handleHoverEnd}
                  />
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Sidebar control */}
        <SidebarControl expanded={isExpanded} />
      </div>

      {/* Hover tooltip (collapsed mode) — fixed to escape overflow clipping */}
      {tip && (
        <div
          className={cn("fixed z-50 pointer-events-none px-2 py-1 rounded-md text-xs whitespace-nowrap", FLOATING_SURFACE)}
          style={{ left: COLLAPSED_WIDTH + 8, top: tip.y, transform: "translateY(-50%)" }}
        >
          {tip.name}
        </div>
      )}

      {/* 저장소 우클릭 메뉴 — 트리 행과 접힌 줄이 같은 메뉴를 쓴다 */}
      {menu && (
        <RepoHeaderContextMenu
          repo={menu.repo}
          settings={settingsData}
          position={{ x: menu.x, y: menu.y }}
          onRemove={() => {
            removeRepo(menu.repo.path);
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

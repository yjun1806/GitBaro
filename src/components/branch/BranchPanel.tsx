import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, RefObject } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownUp, Eye, Layers } from "lucide-react";
import { useBranchBases, useRecentBranches } from "@/api/queries";
import { cn } from "@/lib/utils";
import { isImeComposing } from "@/lib/keyboard";
import type { BranchInfo, WorktreeInfo } from "@/types";
import { AnchoredPanel } from "@/components/ui/AnchoredPanel";
import { EmptyState } from "@/components/ui/EmptyState";
import { PanelHeader, PanelSearch, SectionLabel } from "@/components/ui/PanelHeader";
import { Button } from "@/components/ui/Button";
import { FLOATING_SURFACE } from "@/components/ui/layers";
import { BranchContextMenu } from "./BranchContextMenu";
import { BranchPanelRowView } from "./BranchPanelRow";
import {
  classifyBranches,
  flattenSections,
  type BranchPanelRow,
  type BranchPanelSection,
  type BranchPanelSections,
  type BranchPanelSort,
} from "./branch-panel-model";
import { nextActiveName } from "./visible-branches";
import { useHistoryViewStore, viewTargetFor, type ViewTarget } from "@/stores/history-view";
import { useSetHistoryView } from "@/components/graph/useHistoryView";
import { contextMenuPoint } from "@/components/ui/ContextMenu";
import { useRepositoryStore } from "@/stores/repository";
import { useMenuActions } from "@/hooks/useMenuActions";
import { gitHubRemoteBranchUrl } from "@/lib/utils";

/** 관찰자를 쓸 수 없는 환경(테스트 등)에서 기반 브랜치를 계산할 앞쪽 행 수. */
const FALLBACK_VISIBLE_ROWS = 30;

export interface BranchPanelProps {
  /** 이 패널이 뜨는 자리를 정하는 트리거 버튼(시안 D6이 아니라 W-Top-T1: 트리거 바로 아래에 연다). */
  anchorRef: RefObject<HTMLElement | null>;
  /** 머리글에 붙일 저장소 이름. */
  repoName: string;
  activeRepoPath: string | null;
  branches: BranchInfo[];
  worktrees: WorktreeInfo[];
  /** 지금 브랜치. 분리된 HEAD면 null이고, 그때는 비교·Merge를 쓸 수 없다. */
  currentBranch: string | null;
  onSwitch: (branchName: string) => void;
  onOpenWorktree: (path: string) => void;
  onCompare: (branchName: string) => void;
  onMerge: (branchName: string) => void;
  onRename: (branchName: string) => void;
  onDelete: (branchName: string) => void;
  onCopyName: (branchName: string) => void;
  onCreateBranch: () => void;
  onClose: () => void;
}

/**
 * 브랜치 패널(시안 D6). 「워크트리에서 쓰는 중 / 로컬 / 원격」 세 칸으로 나누고, 행마다
 * 기반 브랜치와 ↑, 체크아웃(또는 이동)·비교·Merge 버튼을 둔다. 행을 누르면 체크아웃하지 않고
 * 그 브랜치의 이력을 그래프에서 본다. 체크아웃은 「체크아웃」 버튼으로만 한다. 다른 워크트리가
 * 쓰는 브랜치는 체크아웃 대신 그 워크트리로 이동한다. 우클릭 메뉴로 이름 변경·삭제·이름 복사를 한다.
 * 기반 브랜치는 추정값이 섞여 있고 비용이 들어서 화면에 보이는 행만 계산한다.
 */
export function BranchPanel({
  anchorRef,
  repoName,
  activeRepoPath,
  branches,
  worktrees,
  currentBranch,
  onSwitch,
  onOpenWorktree,
  onCompare,
  onMerge,
  onRename,
  onDelete,
  onCopyName,
  onCreateBranch,
  onClose,
}: BranchPanelProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const [query, setQuery] = useState("");
  const [activeName, setActiveName] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ row: BranchPanelRow; x: number; y: number } | null>(null);
  const [sortBy, setSortBy] = useState<BranchPanelSort>("recent");
  const [collapsed, setCollapsed] = useState<ReadonlySet<BranchPanelSection>>(new Set());
  const { data: recentNames } = useRecentBranches(activeRepoPath);
  const remotes = useRepositoryStore((s) => s.activeRepo?.remotes);
  const menuActions = useMenuActions();

  const sections = useMemo(
    () => classifyBranches(branches, worktrees, activeRepoPath, query, { sortBy, recentNames }),
    [branches, worktrees, activeRepoPath, query, sortBy, recentNames],
  );
  // 접은 칸의 행은 화살표 이동·기반 브랜치 조회에서 뺀다.
  const rows = useMemo(
    () => flattenSections(sections).filter((r) => !collapsed.has(r.section)),
    [sections, collapsed],
  );
  const rowNames = useMemo(() => rows.map((r) => r.branch.name), [rows]);

  const { rootRef, visibleNames } = useVisibleRowNames(rowNames);
  const baseNames = useMemo(() => {
    const localNonDefault = new Set(
      rows.filter((r) => !r.branch.isRemote && !r.branch.isDefault).map((r) => r.branch.name),
    );
    return visibleNames.filter((n) => localNonDefault.has(n));
  }, [rows, visibleNames]);
  const bases = useBranchBases(activeRepoPath, baseNames);

  const remoteNames = new Set(sections.remote.map((r) => r.branch.name.split("/")[0]));
  const remoteTitle =
    remoteNames.size === 1
      ? t("branchPanel.remoteOf", { remote: [...remoteNames][0] })
      : t("branchPanel.remote");

  // 행을 누르면 체크아웃하지 않고 본다. 지금 브랜치 행은 「현재 체크아웃」 보기로 돌아간다.
  const viewed = useHistoryViewStore((s) => viewTargetFor(s, activeRepoPath));
  const setView = useSetHistoryView();
  const viewRow = (row: BranchPanelRow) => {
    const target: ViewTarget | null =
      row.action === "current" ? null : { kind: "ref", name: row.branch.name, isRemote: row.branch.isRemote };
    setView(target);
    onClose();
  };
  const isViewed = (row: BranchPanelRow) =>
    viewed?.kind === "ref" && viewed.name === row.branch.name && viewed.isRemote === row.branch.isRemote;
  // 보기와 섞이지 않게, 체크아웃·비교·Merge를 시작하면 보기를 끝낸다.
  const endView = () => useHistoryViewStore.getState().reset();

  // 모든 브랜치를 합쳐 본다(체크아웃 없음). 예전 그래프 머리 「보는 브랜치」 고르기에 있던
  // 「모든 브랜치」 옵션을 여기 패널로 옮긴다(검색 중에는 실제 브랜치만 보이게 감춘다).
  const isAllViewed = viewed?.kind === "all";
  const viewAll = () => {
    setView({ kind: "all" });
    onClose();
  };

  // 명시적인 체크아웃(다른 워크트리가 쓰는 브랜치는 그 워크트리로 이동).
  const runPrimary = (row: BranchPanelRow) => {
    if (row.action === "current") return;
    endView();
    if (row.action === "openWorktree" && row.worktree) onOpenWorktree(row.worktree.path);
    else onSwitch(row.branch.name);
    onClose();
  };

  // 비교·Merge는 지금 브랜치가 있어야 하고, 지금 브랜치 자신과는 할 수 없다.
  const canCompare = (row: BranchPanelRow) => currentBranch !== null && row.action !== "current";

  const handleKeyDown = (e: ReactKeyboardEvent) => {
    if (isImeComposing(e)) return;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp":
        e.preventDefault();
        setActiveName((prev) => nextActiveName(rowNames, prev, e.key === "ArrowDown" ? "down" : "up"));
        break;
      case "Enter": {
        const row = rows.find((r) => r.branch.name === activeName);
        if (row) {
          e.preventDefault();
          viewRow(row);
        }
        break;
      }
      case "Escape":
        // A context menu closes first; a plain Escape is left to bubble up
        // to `AnchoredPanel`'s own Escape handler, which closes the panel
        // and returns focus to its trigger (`useDialogA11y`, shared with `Dialog`).
        if (menu) {
          e.preventDefault();
          e.stopPropagation();
          setMenu(null);
        }
        break;
    }
  };

  useEffect(() => {
    if (!activeName) return;
    const rowsInView = rootRef.current?.querySelectorAll<HTMLElement>("[data-branch-name]") ?? [];
    const el = [...rowsInView].find((node) => node.dataset.branchName === activeName);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [activeName, rootRef]);

  const toggleSection = (section: BranchPanelSection) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });

  const renderSection = (section: keyof BranchPanelSections, title: string) => {
    const sectionRows = sections[section];
    if (sectionRows.length === 0) return null;
    const isCollapsed = collapsed.has(section);
    return (
      <section aria-label={title}>
        <SectionLabel
          title={title}
          count={sectionRows.length}
          collapsed={isCollapsed}
          onToggle={() => toggleSection(section)}
          expandLabel={t("branchPanel.expand", { section: title })}
          collapseLabel={t("branchPanel.collapse", { section: title })}
          banner
          trailing={
            section === "local" && !isCollapsed ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSortBy((s) => (s === "recent" ? "name" : "recent"))}
                title={t("branchPanel.sortHint")}
                icon={<ArrowDownUp className="w-3 h-3" aria-hidden="true" />}
              >
                {t(sortBy === "recent" ? "branchPanel.sortRecent" : "branchPanel.sortName")}
              </Button>
            ) : undefined
          }
        />
        {!isCollapsed && sectionRows.map((row) => (
          <BranchPanelRowView
            key={row.branch.name}
            row={row}
            baseInfo={bases.get(row.branch.name)}
            isActive={activeName === row.branch.name}
            canCompare={canCompare(row)}
            isViewed={isViewed(row)}
            onView={() => viewRow(row)}
            onPrimary={() => runPrimary(row)}
            onCompare={() => {
              endView();
              onCompare(row.branch.name);
              onClose();
            }}
            onMerge={() => {
              endView();
              onMerge(row.branch.name);
              onClose();
            }}
            onContextMenu={(e: ReactMouseEvent) => {
              e.preventDefault();
              setMenu({ row, ...contextMenuPoint(e) });
            }}
          />
        ))}
      </section>
    );
  };

  return (
    <AnchoredPanel
      anchorRef={anchorRef}
      onClose={onClose}
      labelledBy={titleId}
      className={cn(
        FLOATING_SURFACE,
        "w-[420px] max-w-[calc(100vw-24px)] max-h-[calc(100vh-24px)] flex flex-col overflow-hidden rounded-(--radius-panel)",
      )}
    >
      <div onKeyDown={handleKeyDown} className="flex flex-col min-h-0 flex-1">
        <PanelHeader
          titleId={titleId}
          title={t("branchPanel.title")}
          subtitle={repoName}
          primaryLabel={t("branchPanel.newBranch")}
          onPrimary={() => {
            onCreateBranch();
            onClose();
          }}
          closeLabel={t("branchPanel.close")}
          onClose={onClose}
        />

        <PanelSearch
          value={query}
          onChange={(v) => {
            setQuery(v);
            setActiveName(null);
          }}
          placeholder={t("branchPanel.search")}
        />

        <div ref={rootRef} className="flex-1 min-h-0 overflow-y-auto border-t border-(--line)">
          {!query && <AllBranchesRow selected={isAllViewed} onSelect={viewAll} />}
          {flattenSections(sections).length === 0 ? (
            <EmptyState layout="row" title={query ? t("branchPanel.noMatch") : t("branch.noBranches")} />
          ) : (
            <>
              {renderSection("inWorktree", t("branchPanel.inWorktree"))}
              {renderSection("local", t("branchPanel.local"))}
              {renderSection("remote", remoteTitle)}
            </>
          )}
        </div>

        <p className="px-3.5 py-2.5 border-t border-(--line) text-[11.5px] leading-[18px] text-muted-foreground shrink-0">
          {t("branchPanel.hint")}
        </p>
      </div>

      {menu && (
        <BranchContextMenu
          isCurrent={menu.row.action === "current"}
          isDefault={menu.row.branch.isDefault}
          isRemote={menu.row.branch.isRemote}
          isViewed={isViewed(menu.row)}
          position={{ x: menu.x, y: menu.y }}
          onView={() => {
            viewRow(menu.row);
            setMenu(null);
          }}
          onOpenOnGitHub={(() => {
            // 로컬 브랜치는 추적하는 원격 브랜치(이름이 다를 수 있다)를, 그 원격의 주소로 연다.
            const ref = menu.row.branch.isRemote ? menu.row.branch.name : menu.row.branch.upstream;
            const url = ref ? gitHubRemoteBranchUrl(remotes ?? [], ref) : null;
            return url ? () => menuActions.openInBrowser(url) : undefined;
          })()}
          onCheckout={() => {
            runPrimary(menu.row);
            setMenu(null);
          }}
          onCompare={() => {
            if (canCompare(menu.row)) {
              endView();
              onCompare(menu.row.branch.name);
              onClose();
            }
            setMenu(null);
          }}
          onMerge={() => {
            if (canCompare(menu.row)) {
              endView();
              onMerge(menu.row.branch.name);
              onClose();
            }
            setMenu(null);
          }}
          onRename={() => {
            onRename(menu.row.branch.name);
            setMenu(null);
          }}
          onDelete={() => {
            onDelete(menu.row.branch.name);
            setMenu(null);
          }}
          onCopyName={() => {
            onCopyName(menu.row.branch.name);
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </AnchoredPanel>
  );
}

/**
 * 「모든 브랜치」를 합쳐 보는 고정 행. 실제 브랜치가 아니라 `BranchPanelRowView`를 쓸 수 없어
 * 예전 그래프 머리 고르기의 같은 옵션과 같은 뜻(Layers 아이콘, 체크아웃 없음)을 이 패널의 행 모양에
 * 맞춰 그린다.
 */
function AllBranchesRow({ selected, onSelect }: { selected: boolean; onSelect: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onSelect}
      title={t("historyView.pickerHint")}
      className={cn(
        "flex items-center gap-2 w-full min-h-[42px] px-3.5 py-1 border-b border-(--line) text-left transition-colors",
        selected ? "bg-(--acc-sel)" : "hover:bg-(--acc-sel)",
      )}
    >
      <span className="w-3.5 shrink-0 flex justify-center">
        {selected && (
          <Eye className="w-[13px] h-[13px] text-info" strokeWidth={2.5} aria-label={t("branchPanel.viewing")} />
        )}
      </span>
      <Layers className="w-3.5 h-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      {/* 다른 행처럼 보는 중은 굵기가 아니라 Eye 아이콘으로만 말한다(BranchPanelRowView와 같은 규칙 —
          거기도 isViewed로는 굵기를 바꾸지 않고, isCurrent일 때만 굵어진다). */}
      <span className="text-[11.5px] font-medium text-(--fg)">{t("historyView.allBranches")}</span>
    </button>
  );
}

/**
 * 스크롤 영역에 보이는 행의 브랜치 이름(`data-branch-name`). 관찰자를 쓸 수 없으면
 * 앞쪽 몇 행을 보이는 것으로 친다.
 */
function useVisibleRowNames(rowNames: readonly string[]) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [visibleNames, setVisibleNames] = useState<string[]>([]);
  const namesKey = rowNames.join("\n");

  useEffect(() => {
    const root = rootRef.current;
    const names = namesKey ? namesKey.split("\n") : [];
    if (!root || typeof IntersectionObserver === "undefined") {
      setVisibleNames(names.slice(0, FALLBACK_VISIBLE_ROWS));
      return;
    }
    const seen = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const name = (entry.target as HTMLElement).dataset.branchName;
          if (!name) continue;
          if (entry.isIntersecting) seen.add(name);
          else seen.delete(name);
        }
        setVisibleNames(names.filter((n) => seen.has(n)));
      },
      { root, rootMargin: "120px 0px" },
    );
    root.querySelectorAll<HTMLElement>("[data-branch-name]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [namesKey]);

  return { rootRef, visibleNames };
}

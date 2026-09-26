import { useMemo, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, RefObject } from "react";
import { useTranslation } from "react-i18next";
import { isImeComposing } from "@/lib/keyboard";
import { useMenuActions } from "@/hooks/useMenuActions";
import type { WorktreeInfo } from "@/types";
import { AnchoredPanel } from "@/components/ui/AnchoredPanel";
import { PanelEmptyState, PanelHeader, PanelSearch, PanelSectionHeader } from "@/components/ui/PanelHeader";
import { WorktreeContextMenu } from "./WorktreeContextMenu";
import { WorktreePanelRow } from "./WorktreePanelRow";
import {
  classifyWorktrees,
  flattenWorktreeSections,
  type WorktreePanelSection,
  type WorktreePanelSections,
} from "./worktree-panel-model";

export interface WorktreePanelProps {
  /** 이 패널이 뜨는 자리를 정하는 트리거 버튼(브랜치 패널과 같은 자리 — 트리거 바로 아래에 연다). */
  anchorRef: RefObject<HTMLElement | null>;
  repoName: string;
  worktrees: WorktreeInfo[];
  currentPath: string | null;
  onOpenWorktree: (path: string) => void;
  onOpenTerminal: (path: string) => void;
  onOpenEditor: (path: string) => void;
  onRemoveWorktree: (path: string) => void;
  onCreateWorktree: () => void;
  onClose: () => void;
}

/**
 * 워크트리 패널(W-Top-T1). 브랜치 패널(시안 D6, `BranchPanel.tsx`)과 같은 틀
 * (`PanelHeader` + `PanelSearch` + `AnchoredPanel`)을 쓰고, 워크트리를
 * 「메인 / 링크된 워크트리 / 정리 필요」 세 칸으로 나눈다.
 */
export function WorktreePanel({
  anchorRef,
  repoName,
  worktrees,
  currentPath,
  onOpenWorktree,
  onOpenTerminal,
  onOpenEditor,
  onRemoveWorktree,
  onCreateWorktree,
  onClose,
}: WorktreePanelProps) {
  const { t } = useTranslation();
  const actions = useMenuActions();
  const titleId = "worktree-panel-title";
  const [query, setQuery] = useState("");
  const [activePath, setActivePath] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ wt: WorktreeInfo; x: number; y: number } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const sections = useMemo(() => classifyWorktrees(worktrees, query), [worktrees, query]);
  const rows = useMemo(() => flattenWorktreeSections(sections), [sections]);
  const rowPaths = rows.map((r) => r.worktree.path);

  const runOpen = (wt: WorktreeInfo) => {
    if (wt.isPrunable) return;
    onOpenWorktree(wt.path);
    onClose();
  };

  const handleKeyDown = (e: ReactKeyboardEvent) => {
    if (isImeComposing(e)) return;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        e.preventDefault();
        if (rowPaths.length === 0) {
          setActivePath(null);
          break;
        }
        const i = activePath ? rowPaths.indexOf(activePath) : -1;
        const dir = e.key === "ArrowDown" ? 1 : -1;
        const next = i < 0 ? (dir === 1 ? 0 : rowPaths.length - 1) : (i + dir + rowPaths.length) % rowPaths.length;
        setActivePath(rowPaths[next]);
        break;
      }
      case "Enter": {
        const row = rows.find((r) => r.worktree.path === activePath);
        if (row) {
          e.preventDefault();
          runOpen(row.worktree);
        }
        break;
      }
      case "Escape":
        if (menu) {
          e.preventDefault();
          e.stopPropagation();
          setMenu(null);
        }
        break;
    }
  };

  const canRemove = (wt: WorktreeInfo) => !wt.isLocked && !wt.isMain && wt.path !== currentPath;

  const renderSection = (section: keyof WorktreePanelSections, title: string) => {
    const sectionRows = sections[section];
    if (sectionRows.length === 0) return null;
    return (
      <section aria-label={title}>
        {/* 「기본 폴더」는 브랜치 main과 헷갈리기 쉬워 뜻을 툴팁으로 덧붙인다. */}
        <div title={section === "main" ? t("worktree.primaryFolderHint") : undefined}>
          <PanelSectionHeader title={title} />
        </div>
        {sectionRows.map(({ worktree }) => (
          <WorktreePanelRow
            key={worktree.path}
            worktree={worktree}
            isCurrent={worktree.path === currentPath}
            isActive={activePath === worktree.path}
            canRemove={canRemove(worktree)}
            onOpen={() => runOpen(worktree)}
            onOpenTerminal={() => onOpenTerminal(worktree.path)}
            onOpenEditor={() => onOpenEditor(worktree.path)}
            onRemove={() => setConfirmRemove(worktree.path)}
            onContextMenu={(e: ReactMouseEvent) => {
              e.preventDefault();
              setMenu({ wt: worktree, x: e.clientX, y: e.clientY });
            }}
          />
        ))}
      </section>
    );
  };

  const sectionTitle: Record<WorktreePanelSection, string> = {
    main: t("worktreePanel.sectionMain"),
    linked: t("worktreePanel.sectionLinked"),
    prunable: t("worktreePanel.sectionPrunable"),
  };

  return (
    <AnchoredPanel
      anchorRef={anchorRef}
      onClose={onClose}
      labelledBy={titleId}
      className="w-[380px] max-w-[calc(100vw-24px)] max-h-[calc(100vh-24px)] flex flex-col overflow-hidden bg-card rounded-(--radius-panel) shadow-[0_24px_60px_rgba(0,0,0,0.18)] ring-1 ring-(--line)"
    >
      <div onKeyDown={handleKeyDown} className="flex flex-col min-h-0 flex-1">
        <PanelHeader
          titleId={titleId}
          title={t("worktreePanel.title")}
          subtitle={repoName}
          primaryLabel={t("worktree.newWorktree")}
          onPrimary={() => {
            onCreateWorktree();
            onClose();
          }}
          closeLabel={t("branchPanel.close")}
          onClose={onClose}
        />

        <PanelSearch value={query} onChange={setQuery} placeholder={t("worktree.filterWorktrees")} />

        <div className="flex-1 min-h-0 overflow-y-auto border-t border-(--line)">
          {rows.length === 0 ? (
            <PanelEmptyState message={query ? t("branchPanel.noMatch") : t("worktree.noWorktrees")} />
          ) : (
            <>
              {renderSection("main", sectionTitle.main)}
              {renderSection("linked", sectionTitle.linked)}
              {renderSection("prunable", sectionTitle.prunable)}
            </>
          )}
        </div>
      </div>

      {menu && (
        <WorktreeContextMenu
          isLocked={menu.wt.isLocked || menu.wt.isMain || menu.wt.path === currentPath}
          canOpen={!menu.wt.isPrunable}
          position={{ x: menu.x, y: menu.y }}
          onOpen={() => {
            runOpen(menu.wt);
            setMenu(null);
          }}
          onCopyPath={() => {
            actions.copy(menu.wt.path);
            setMenu(null);
          }}
          onRemove={() => {
            setConfirmRemove(menu.wt.path);
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      )}

      {confirmRemove && (
        <div className="absolute inset-x-3.5 bottom-3.5 bg-card border border-border rounded-lg shadow-lg p-3 z-10 animate-toast-in">
          <p className="text-sm text-foreground mb-2">
            {t("worktree.removeConfirm", { path: confirmRemove.split("/").filter(Boolean).pop() })}
          </p>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setConfirmRemove(null)}
              className="px-3 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={() => {
                onRemoveWorktree(confirmRemove);
                setConfirmRemove(null);
              }}
              className="px-3 py-1 text-xs bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded transition-colors"
            >
              {t("common.delete")}
            </button>
          </div>
        </div>
      )}
    </AnchoredPanel>
  );
}

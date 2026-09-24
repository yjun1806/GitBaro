import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Search, X } from "lucide-react";
import { useBranchBases } from "@/api/queries";
import { isImeComposing } from "@/lib/keyboard";
import type { BranchInfo, WorktreeInfo } from "@/types";
import { BranchContextMenu } from "./BranchContextMenu";
import { BranchPanelRowView } from "./BranchPanelRow";
import { classifyBranches, flattenSections, type BranchPanelRow } from "./branch-panel-model";
import { nextActiveName } from "./visible-branches";

/** 관찰자를 쓸 수 없는 환경(테스트 등)에서 기반 브랜치를 계산할 앞쪽 행 수. */
const FALLBACK_VISIBLE_ROWS = 30;

export interface BranchPanelProps {
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
 * 기반 브랜치와 ↑, 전환(또는 이동)·비교·Merge 버튼을 둔다. 다른 워크트리가 쓰는 브랜치는
 * 전환 대신 그 워크트리로 이동한다. 우클릭 메뉴로 이름 변경·삭제·이름 복사를 한다.
 * 기반 브랜치는 추정값이 섞여 있고 비용이 들어서 화면에 보이는 행만 계산한다.
 */
export function BranchPanel({
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

  const sections = useMemo(
    () => classifyBranches(branches, worktrees, activeRepoPath, query),
    [branches, worktrees, activeRepoPath, query],
  );
  const rows = useMemo(() => flattenSections(sections), [sections]);
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

  const runPrimary = (row: BranchPanelRow) => {
    if (row.action === "current") return;
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
          runPrimary(row);
        }
        break;
      }
      case "Escape":
        e.preventDefault();
        if (menu) setMenu(null);
        else onClose();
        break;
    }
  };

  useEffect(() => {
    if (!activeName) return;
    const rowsInView = rootRef.current?.querySelectorAll<HTMLElement>("[data-branch-name]") ?? [];
    const el = [...rowsInView].find((node) => node.dataset.branchName === activeName);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [activeName, rootRef]);

  const renderSection = (title: string, sectionRows: BranchPanelRow[]) =>
    sectionRows.length === 0 ? null : (
      <section aria-label={title}>
        <h3 className="px-3.5 pt-2.5 pb-1 text-[11px] font-bold text-(--muted) bg-(--acc-faint) border-b border-(--line)">
          {title}
        </h3>
        {sectionRows.map((row) => (
          <BranchPanelRowView
            key={row.branch.name}
            row={row}
            base={bases.get(row.branch.name)}
            isActive={activeName === row.branch.name}
            canCompare={canCompare(row)}
            onPrimary={() => runPrimary(row)}
            onCompare={() => {
              onCompare(row.branch.name);
              onClose();
            }}
            onMerge={() => {
              onMerge(row.branch.name);
              onClose();
            }}
            onContextMenu={(e: ReactMouseEvent) => {
              e.preventDefault();
              setMenu({ row, x: e.clientX, y: e.clientY });
            }}
          />
        ))}
      </section>
    );

  return (
    <aside
      role="dialog"
      aria-labelledby={titleId}
      onKeyDown={handleKeyDown}
      className="fixed z-50 right-3 top-[60px] bottom-3 w-[420px] max-w-[calc(100vw-24px)] flex flex-col overflow-hidden bg-card rounded-(--radius-panel) shadow-[0_24px_60px_rgba(0,0,0,0.18)] ring-1 ring-(--line)"
    >
      <div className="flex items-center gap-2 px-3.5 py-3 border-b border-(--line) shrink-0">
        <strong id={titleId} className="text-sm text-(--fg)">
          {t("branchPanel.title")}
        </strong>
        <span className="text-xs text-(--faint) truncate min-w-0">{repoName}</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => {
            onCreateBranch();
            onClose();
          }}
          className="h-[26px] px-2.5 rounded-[7px] bg-primary text-primary-foreground text-xs font-bold hover:bg-primary-hover transition-colors shrink-0"
        >
          {t("branch.newBranch")}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("branchPanel.close")}
          className="w-[26px] h-[26px] flex items-center justify-center rounded-[7px] text-(--muted) hover:bg-accent transition-colors shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <label className="mx-3.5 my-2.5 flex items-center gap-2 h-[30px] px-2.5 rounded-(--radius-item) bg-(--chip) shrink-0">
        <Search className="w-[13px] h-[13px] text-(--faint) shrink-0" aria-hidden="true" />
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveName(null);
          }}
          placeholder={t("branchPanel.search")}
          aria-label={t("branchPanel.search")}
          className="flex-1 min-w-0 bg-transparent outline-none text-[12.5px] placeholder:text-(--faint)"
        />
      </label>

      <div ref={rootRef} className="flex-1 min-h-0 overflow-y-auto border-t border-(--line)">
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            {query ? t("branchPanel.noMatch") : t("branch.noBranches")}
          </p>
        ) : (
          <>
            {renderSection(t("branchPanel.inWorktree"), sections.inWorktree)}
            {renderSection(t("branchPanel.local"), sections.local)}
            {renderSection(remoteTitle, sections.remote)}
          </>
        )}
      </div>

      <p className="px-3.5 py-2.5 border-t border-(--line) text-[11.5px] leading-[18px] text-(--muted) shrink-0">
        {t("branchPanel.hint")}
      </p>

      {menu && (
        <BranchContextMenu
          isCurrent={menu.row.action === "current"}
          isDefault={menu.row.branch.isDefault}
          isRemote={menu.row.branch.isRemote}
          position={{ x: menu.x, y: menu.y }}
          onCheckout={() => {
            runPrimary(menu.row);
            setMenu(null);
          }}
          onCompare={() => {
            if (canCompare(menu.row)) {
              onCompare(menu.row.branch.name);
              onClose();
            }
            setMenu(null);
          }}
          onMerge={() => {
            if (canCompare(menu.row)) {
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
    </aside>
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

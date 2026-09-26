import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Eye, GitBranch, Globe, Layers } from "lucide-react";
import { useRepositoryStore } from "@/stores/repository";
import { sameViewTarget, type ViewTarget } from "@/stores/history-view";
import { useBranches } from "@/api/queries";
import { fuzzyFilter } from "@/lib/fuzzy-search";
import { cn } from "@/lib/utils";
import type { BranchInfo } from "@/types";
import { AnchoredPanel } from "@/components/ui/AnchoredPanel";
import { PanelSearch, SectionLabel } from "@/components/ui/PanelHeader";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { FLOATING_SURFACE } from "@/components/ui/layers";
import { useHistoryView, useSetHistoryView } from "./useHistoryView";

/** 고를 수 있는 브랜치: 로컬 전부, 원격 전부(`origin/HEAD` 같은 별칭은 뺀다). */
export function viewableBranches(branches: readonly BranchInfo[], query: string) {
  const q = query.trim();
  const local = branches.filter((b) => !b.isRemote);
  const remote = branches.filter((b) => b.isRemote && !b.name.endsWith("/HEAD"));
  return {
    local: fuzzyFilter(local, q, (b) => b.name),
    remote: fuzzyFilter(remote, q, (b) => b.name),
  };
}

function Option({
  selected,
  icon,
  label,
  hint,
  mono = false,
  onSelect,
}: {
  selected: boolean;
  icon: ReactNode;
  label: string;
  hint?: string;
  mono?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "flex items-center gap-2 w-full h-7 px-3.5 text-left text-[12.5px] transition-colors",
        selected ? "bg-(--acc-sel) text-foreground" : "text-(--fg2) hover:bg-(--acc-sel)",
      )}
    >
      <span className="w-3.5 shrink-0 flex justify-center">
        {selected ? <Check className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden="true" /> : null}
      </span>
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className={cn("truncate", mono && "font-mono text-[11.5px]")}>{label}</span>
      {hint && <span className="ml-auto shrink-0 text-[11.5px] text-muted-foreground">{hint}</span>}
    </button>
  );
}

/**
 * 그래프 머리의 「보는 브랜치」 선택. 기본은 「현재 체크아웃」이고, 로컬·원격 브랜치 하나나
 * 「모든 브랜치」를 고르면 체크아웃하지 않고 그 이력을 본다.
 */
export function ViewBranchPicker() {
  const { t } = useTranslation();
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const { data: branches = [] } = useBranches(activeRepoPath);
  const { target, currentBranch } = useHistoryView();
  const setView = useSetHistoryView();
  const lists = useMemo(() => viewableBranches(branches, query), [branches, query]);

  const label =
    target === null
      ? t("historyView.current")
      : target.kind === "all"
        ? t("historyView.allBranches")
        : target.name;

  const choose = (next: ViewTarget | null) => {
    setView(next);
    setOpen(false);
    setQuery("");
  };
  const viewing = target !== null;

  return (
    <>
      <Button
        ref={triggerRef}
        size="sm"
        variant="ghost"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t("historyView.pickerHint")}
        className="min-w-0 max-w-[260px]"
      >
        <Eye className={cn("w-3 h-3 shrink-0", viewing && "text-info")} aria-hidden="true" />
        <span className="shrink-0 text-muted-foreground">{t("historyView.pickerLabel")}</span>
        <span className={cn("truncate", target?.kind === "ref" && "font-mono")}>{label}</span>
        <ChevronDown className="w-3 h-3 shrink-0 opacity-60" aria-hidden="true" />
      </Button>
      {open && (
        <AnchoredPanel
          anchorRef={triggerRef}
          onClose={() => {
            setOpen(false);
            setQuery("");
          }}
          labelledBy={titleId}
          className={cn(
            "w-[340px] max-w-[calc(100vw-24px)] max-h-[calc(100vh-24px)] flex flex-col overflow-hidden rounded-(--radius-panel)",
            FLOATING_SURFACE,
          )}
        >
          <p id={titleId} className="px-3.5 pt-3 text-[13px] font-bold text-foreground">
            {t("historyView.pickerTitle")}
          </p>
          <PanelSearch value={query} onChange={setQuery} placeholder={t("branchPanel.search")} />
          <div role="listbox" aria-labelledby={titleId} className="flex-1 min-h-0 overflow-y-auto pb-1.5">
            {!query && (
              <>
                <Option
                  selected={target === null}
                  icon={<GitBranch className="w-3.5 h-3.5" />}
                  label={t("historyView.current")}
                  hint={currentBranch ?? t("branch.detachedHead")}
                  onSelect={() => choose(null)}
                />
                <Option
                  selected={target?.kind === "all"}
                  icon={<Layers className="w-3.5 h-3.5" />}
                  label={t("historyView.allBranches")}
                  onSelect={() => choose({ kind: "all" })}
                />
              </>
            )}
            {lists.local.length > 0 && (
              <SectionLabel title={t("branchPanel.local")} className="border-t border-(--line)" />
            )}
            {lists.local.map((b) => {
              const next: ViewTarget = { kind: "ref", name: b.name, isRemote: false };
              return (
                <Option
                  key={b.name}
                  mono
                  selected={b.isHead ? target === null : sameViewTarget(target, next)}
                  icon={<GitBranch className="w-3.5 h-3.5" />}
                  label={b.name}
                  hint={b.isHead ? t("historyView.checkedOut") : undefined}
                  onSelect={() => choose(b.isHead ? null : next)}
                />
              );
            })}
            {lists.remote.length > 0 && (
              <SectionLabel title={t("branchPanel.remote")} className="border-t border-(--line)" />
            )}
            {lists.remote.map((b) => {
              const next: ViewTarget = { kind: "ref", name: b.name, isRemote: true };
              return (
                <Option
                  key={b.name}
                  mono
                  selected={sameViewTarget(target, next)}
                  icon={<Globe className="w-3.5 h-3.5" />}
                  label={b.name}
                  onSelect={() => choose(next)}
                />
              );
            })}
            {query && lists.local.length === 0 && lists.remote.length === 0 && (
              <EmptyState layout="row" title={t("branchPanel.noMatch")} />
            )}
          </div>
        </AnchoredPanel>
      )}
    </>
  );
}

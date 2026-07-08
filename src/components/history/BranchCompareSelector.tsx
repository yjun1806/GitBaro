import { useState, useRef, useEffect } from "react";
import { ArrowLeftRight, Cloud, GitCompareArrows, Search, X, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { BranchInfo } from "@/types";

interface BranchCompareSelectorProps {
  branches: BranchInfo[];
  currentBranch: string | null;
  compareBranch: string | null;
  onSelect: (branchName: string | null) => void;
}

/**
 * Branch identity relative to its remote:
 * - synced: local branch that tracks a remote (local ⇄ remote)
 * - local:  local branch with no upstream (local-only)
 * - remote: remote branch with no local counterpart (remote-only)
 */
type BranchKind = "synced" | "local" | "remote";

function getBranchKind(b: BranchInfo): BranchKind {
  if (b.isRemote) return "remote";
  return b.upstream ? "synced" : "local";
}

function BranchKindIcon({ kind }: { kind: BranchKind }) {
  if (kind === "remote") {
    return <Cloud className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />;
  }
  if (kind === "synced") {
    return <ArrowLeftRight className="w-3.5 h-3.5 shrink-0 text-info" />;
  }
  return (
    <span className="w-3.5 shrink-0 flex justify-center">
      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
    </span>
  );
}

export function BranchCompareSelector({
  branches,
  currentBranch,
  compareBranch,
  onSelect,
}: BranchCompareSelectorProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  // Remote branches already tracked by a local branch are shown once as the
  // local "synced" entry, so drop those remotes to avoid duplication.
  const trackedUpstreams = new Set(
    branches
      .filter((b) => !b.isRemote && b.upstream)
      .map((b) => b.upstream as string),
  );

  // Filter branches: exclude the current branch and remotes that duplicate a
  // tracked local branch; keep local-only, synced, and remote-only.
  const lowerQuery = query.toLowerCase();
  const filteredBranches = branches.filter(
    (b) =>
      b.name !== currentBranch &&
      b.name.toLowerCase().includes(lowerQuery) &&
      !(b.isRemote && trackedUpstreams.has(b.name)),
  );

  const handleSelect = (branchName: string) => {
    onSelect(branchName === compareBranch ? null : branchName);
    setIsOpen(false);
    setQuery("");
  };

  const handleClear = () => {
    onSelect(null);
    setIsOpen(false);
    setQuery("");
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen((v) => !v)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg border transition-colors",
          compareBranch
            ? "border-primary/40 bg-primary/5 text-primary"
            : "border-border bg-surface hover:bg-accent text-muted-foreground",
        )}
      >
        <GitCompareArrows className="w-4 h-4 shrink-0" />
        <span className="flex-1 truncate text-left">
          {compareBranch
            ? t("compare.comparingWith", { branch: compareBranch })
            : t("compare.selectBranch")}
        </span>
        {compareBranch && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleClear();
            }}
            className="p-0.5 rounded hover:bg-primary/10 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute left-0 top-full mt-1 w-full bg-popover border border-border rounded-xl shadow-xl z-50 overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-border">
            <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-surface border border-border focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20 transition-all">
              <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("compare.filterBranches")}
                className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
              />
            </div>
          </div>

          {/* Branch list */}
          <div className="max-h-60 overflow-y-auto">
            {filteredBranches.length > 0 ? (
              filteredBranches.map((branch) => {
                const isSelected = branch.name === compareBranch;
                const ab = branch.aheadBehindHead;
                const kind = getBranchKind(branch);
                const kindTitle =
                  kind === "synced"
                    ? t("compare.kindSynced")
                    : kind === "local"
                      ? t("compare.kindLocal")
                      : t("compare.kindRemote");
                return (
                  <button
                    key={branch.name}
                    onClick={() => handleSelect(branch.name)}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors",
                      isSelected
                        ? "bg-primary/8 text-primary"
                        : "hover:bg-accent",
                    )}
                  >
                    <span className="flex items-center shrink-0" title={kindTitle}>
                      <BranchKindIcon kind={kind} />
                    </span>
                    <span className="flex-1 truncate text-left">
                      {branch.name}
                    </span>
                    {ab && (ab.ahead > 0 || ab.behind > 0) && (
                      <span className="flex items-center gap-1.5 text-xs tabular-nums shrink-0">
                        {ab.ahead > 0 && (
                          <span
                            className="text-info font-medium"
                            title={t("compare.selectorIncomingTooltip", { count: ab.ahead })}
                          >
                            {"\u2193"}{ab.ahead}
                          </span>
                        )}
                        {ab.behind > 0 && (
                          <span
                            className="text-success font-medium"
                            title={t("compare.selectorOutgoingTooltip", { count: ab.behind })}
                          >
                            {"\u2191"}{ab.behind}
                          </span>
                        )}
                      </span>
                    )}
                    {isSelected && (
                      <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                    )}
                  </button>
                );
              })
            ) : (
              <div className="py-6 text-center">
                <p className="text-sm text-muted-foreground">
                  {t("compare.noBranches")}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

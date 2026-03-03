import { useState, useRef, useEffect } from "react";
import { GitBranch, GitCompareArrows, Search, X, Check } from "lucide-react";
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
 * aheadBehindHead 기준 dot 색상:
 * - ahead(incoming) + behind(outgoing) 모두 → warning
 * - ahead(incoming)만 → info
 * - behind(outgoing)만 → success
 */
type CompareStatus = "both" | "incoming" | "outgoing";
const compareDotStyles: Record<CompareStatus, string> = {
  both: "bg-warning",
  incoming: "bg-info",
  outgoing: "bg-success",
};

function getCompareStatus(ahead: number, behind: number): CompareStatus {
  if (ahead > 0 && behind > 0) return "both";
  if (ahead > 0) return "incoming";
  return "outgoing";
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

  // Filter branches: exclude current branch, only local branches
  const lowerQuery = query.toLowerCase();
  const filteredBranches = branches.filter(
    (b) =>
      !b.isRemote &&
      b.name !== currentBranch &&
      b.name.toLowerCase().includes(lowerQuery),
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
                    <GitBranch
                      className={cn(
                        "w-3.5 h-3.5 shrink-0",
                        isSelected ? "text-primary" : "text-muted-foreground",
                      )}
                    />
                    {/* Dot indicator */}
                    {ab && (ab.ahead > 0 || ab.behind > 0) && (
                      <span
                        className={cn(
                          "w-1.5 h-1.5 rounded-full shrink-0",
                          compareDotStyles[getCompareStatus(ab.ahead, ab.behind)],
                        )}
                      />
                    )}
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

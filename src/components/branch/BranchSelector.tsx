import { useState, useRef, useEffect } from "react";
import { GitBranch, ChevronDown, Search, Plus, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import type { BranchInfo } from "@/types";

interface BranchSelectorProps {
  branches: BranchInfo[];
  currentBranch: string | null;
  onSwitch: (branch: BranchInfo) => void;
  onCreateBranch: () => void;
}

export function BranchSelector({
  branches,
  currentBranch,
  onSwitch,
  onCreateBranch,
}: BranchSelectorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remoteExpanded, setRemoteExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const local = branches.filter(
    (b) => !b.isRemote && b.name.toLowerCase().includes(query.toLowerCase())
  );
  const remote = branches.filter(
    (b) => b.isRemote && b.name.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border hover:bg-accent transition-colors max-w-48"
      >
        <GitBranch className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium text-foreground truncate">
          {currentBranch ?? t("branch.current")}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0 ml-auto" />
      </button>

      {open && (
        <div className="absolute left-0 mt-1 w-72 bg-card border border-border rounded-lg shadow-lg z-50 py-1">
          {/* Search */}
          <div className="px-2 pb-1 border-b border-border">
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted">
              <Search className="w-3.5 h-3.5 text-muted-foreground" />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter branches..."
                className="flex-1 text-sm bg-transparent text-foreground placeholder:text-muted-foreground outline-none"
              />
            </div>
          </div>

          {/* Local branches */}
          <div className="max-h-60 overflow-y-auto">
            {local.length > 0 && (
              <>
                <p className="px-3 pt-2 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Local
                </p>
                {local.map((branch) => (
                  <BranchRow
                    key={branch.name}
                    branch={branch}
                    isCurrent={branch.name === currentBranch}
                    onSelect={() => {
                      onSwitch(branch);
                      setOpen(false);
                    }}
                  />
                ))}
              </>
            )}

            {/* Remote branches */}
            {remote.length > 0 && (
              <>
                <button
                  onClick={() => setRemoteExpanded((v) => !v)}
                  className="w-full flex items-center gap-1 px-3 pt-2 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors"
                >
                  <ChevronRight
                    className={clsx(
                      "w-3 h-3 transition-transform",
                      remoteExpanded && "rotate-90"
                    )}
                  />
                  Remote ({remote.length})
                </button>
                {remoteExpanded &&
                  remote.map((branch) => (
                    <BranchRow
                      key={branch.name}
                      branch={branch}
                      isCurrent={false}
                      onSelect={() => {
                        onSwitch(branch);
                        setOpen(false);
                      }}
                    />
                  ))}
              </>
            )}
          </div>

          {/* New branch */}
          <div className="border-t border-border mt-1 pt-1">
            <button
              onClick={() => {
                onCreateBranch();
                setOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-primary hover:bg-primary/10 transition-colors"
            >
              <Plus className="w-4 h-4" />
              {t("branch.create")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface BranchRowProps {
  branch: BranchInfo;
  isCurrent: boolean;
  onSelect: () => void;
}

function BranchRow({ branch, isCurrent, onSelect }: BranchRowProps) {
  return (
    <button
      onClick={onSelect}
      className={clsx(
        "w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors",
        isCurrent
          ? "bg-primary/10 text-primary"
          : "text-foreground hover:bg-accent"
      )}
    >
      <GitBranch className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <span className="flex-1 truncate text-left">{branch.name}</span>
      {branch.aheadBehind && (branch.aheadBehind.ahead > 0 || branch.aheadBehind.behind > 0) && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          {branch.aheadBehind.ahead > 0 && (
            <span className="text-success">+{branch.aheadBehind.ahead}</span>
          )}
          {branch.aheadBehind.behind > 0 && (
            <span className="text-destructive">-{branch.aheadBehind.behind}</span>
          )}
        </span>
      )}
    </button>
  );
}

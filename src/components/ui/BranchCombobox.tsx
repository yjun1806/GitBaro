import { useState, useRef, useEffect, useMemo } from "react";
import { GitBranch, ChevronDown, Check, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { BranchInfo } from "@/types";

interface BranchComboboxProps {
  value: string;
  branches: BranchInfo[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function BranchCombobox({
  value,
  branches,
  onChange,
  placeholder,
  className,
}: BranchComboboxProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = useMemo(() => {
    if (!query) return branches;
    const q = query.toLowerCase();
    return branches.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.lastCommitAuthor?.name.toLowerCase().includes(q),
    );
  }, [branches, query]);

  const selected = branches.find((b) => b.name === value);

  const handleOpen = () => {
    setOpen(true);
    setQuery("");
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleSelect = (branchName: string) => {
    onChange(branchName);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={ref} className={cn("relative", className)}>
      {/* Trigger */}
      <button
        type="button"
        onClick={handleOpen}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-sm",
          "border border-border rounded-lg bg-card text-foreground",
          "outline-none transition-colors",
          open && "ring-2 ring-ring",
          !open && "hover:border-muted-foreground/40",
        )}
      >
        <GitBranch className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
        <span
          className={cn(
            "flex-1 text-left truncate",
            !selected && "text-muted-foreground",
          )}
        >
          {selected?.name ?? placeholder ?? ""}
        </span>
        <ChevronDown
          className={cn(
            "w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-popover border border-border rounded-lg shadow-lg z-50 overflow-hidden">
          {/* Search input */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("branch.filterBranches")}
              className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
            />
          </div>

          {/* Options */}
          <div className="max-h-48 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground text-center">
                {t("branch.noBranches")}
              </p>
            ) : (
              filtered.map((branch) => {
                const isSelected = branch.name === value;
                return (
                  <button
                    key={branch.name}
                    onClick={() => handleSelect(branch.name)}
                    className={cn(
                      "w-full flex items-start gap-2 px-3 py-2 text-left transition-colors",
                      isSelected
                        ? "bg-primary/10"
                        : "hover:bg-accent",
                    )}
                  >
                    <GitBranch
                      className={cn(
                        "w-3.5 h-3.5 mt-0.5 shrink-0",
                        isSelected
                          ? "text-primary"
                          : "text-muted-foreground",
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <p
                        className={cn(
                          "text-sm truncate",
                          isSelected
                            ? "text-primary font-medium"
                            : "text-foreground",
                        )}
                      >
                        {branch.name}
                      </p>
                      {(branch.lastCommitTime != null ||
                        branch.lastCommitAuthor) && (
                        <p className="text-[11px] text-muted-foreground truncate">
                          {[
                            branch.lastCommitTime != null &&
                              formatRelativeTime(branch.lastCommitTime),
                            branch.lastCommitAuthor &&
                              branch.lastCommitAuthor.name,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      )}
                    </div>
                    {isSelected && (
                      <Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { GitBranch, ChevronDown, Check, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn, formatRelativeTime } from "@/lib/utils";
import { FLOATING_SURFACE } from "./layers";
import { AnchoredPanel } from "./AnchoredPanel";
import { EmptyState } from "./EmptyState";
import type { BranchInfo } from "@/types";

interface BranchComboboxProps {
  value: string;
  branches: BranchInfo[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/**
 * 브랜치 고르는 콤보박스. 목록은 `AnchoredPanel`(고정 위치 + 뷰포트 안으로 클램프)로 띄운다 —
 * `absolute`였을 때는 창(Dialog) 몸통의 `overflow-y-auto`나 감싼 카드의 `overflow-hidden`에
 * 잘렸다(D-high #3). `AnchoredPanel`은 트리거 너비를 모르므로 열 때 재서 넘긴다.
 */
export function BranchCombobox({
  value,
  branches,
  onChange,
  placeholder,
  className,
}: BranchComboboxProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [anchorWidth, setAnchorWidth] = useState<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    setAnchorWidth(triggerRef.current?.getBoundingClientRect().width ?? null);
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
  };

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const handleSelect = (branchName: string) => {
    onChange(branchName);
    close();
  };

  return (
    <div className={cn("relative", className)}>
      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        onClick={handleOpen}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "w-full h-7 flex items-center gap-2 px-2.5 text-[12.5px]",
          "border border-border rounded-(--radius-item) bg-card text-foreground",
          "outline-none transition-colors motion-reduce:transition-none",
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
        <AnchoredPanel
          anchorRef={triggerRef}
          onClose={close}
          labelledBy={titleId}
          style={anchorWidth ? { width: anchorWidth } : undefined}
          className={cn("flex flex-col overflow-hidden rounded-(--radius-item)", FLOATING_SURFACE)}
        >
          <span id={titleId} className="sr-only">
            {placeholder ?? t("branch.filterBranches")}
          </span>
          {/* Search input */}
          <div className="flex items-center gap-2 px-2.5 h-7 border-b border-border shrink-0">
            <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("branch.filterBranches")}
              className="flex-1 text-[12.5px] bg-transparent outline-none placeholder:text-muted-foreground"
            />
          </div>

          {/* Options */}
          <div role="listbox" aria-labelledby={titleId} className="min-h-0 max-h-48 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <EmptyState layout="row" title={t("branch.noBranches")} />
            ) : (
              filtered.map((branch) => {
                const isSelected = branch.name === value;
                return (
                  <button
                    key={branch.name}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(branch.name)}
                    className={cn(
                      "w-full flex items-start gap-2 px-2.5 py-1.5 rounded-(--radius-chip) text-left transition-colors motion-reduce:transition-none",
                      isSelected
                        ? "bg-accent"
                        : "hover:bg-accent",
                    )}
                  >
                    <GitBranch
                      className={cn(
                        "w-3.5 h-3.5 mt-0.5 shrink-0",
                        isSelected
                          ? "text-foreground"
                          : "text-muted-foreground",
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <p
                        className={cn(
                          "text-[12.5px] truncate",
                          isSelected
                            ? "text-foreground font-medium"
                            : "text-foreground",
                        )}
                      >
                        {branch.name}
                      </p>
                      {(branch.lastCommitTime != null ||
                        branch.lastCommitAuthor) && (
                        <p className="text-[11.5px] text-muted-foreground truncate">
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
                      <Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-foreground" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </AnchoredPanel>
      )}
    </div>
  );
}

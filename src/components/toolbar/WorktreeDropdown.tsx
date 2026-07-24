import { useState, useMemo } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { WorktreeList } from "@/components/worktree/WorktreeList";
import type { WorktreeInfo } from "@/types";

interface WorktreeDropdownProps {
  worktrees: WorktreeInfo[];
  currentPath: string | null;
  onOpenWorktree: (path: string) => void;
  onRemoveWorktree: (path: string) => void;
  onCreateWorktree: () => void;
  onClose: () => void;
}

export function WorktreeDropdown({
  worktrees,
  currentPath,
  onOpenWorktree,
  onRemoveWorktree,
  onCreateWorktree,
  onClose,
}: WorktreeDropdownProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);

  // 메인 워크트리를 맨 위로, 나머지는 원래 순서. bare 워크트리는 탐색 대상이 아니다.
  const sorted = useMemo(() => {
    const listed = worktrees.filter((w) => !w.isBare);
    return [...listed].sort((a, b) => Number(b.isMain) - Number(a.isMain));
  }, [worktrees]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return sorted.filter((w) =>
      (w.branch ?? w.path).toLowerCase().includes(q),
    );
  }, [sorted, query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) =>
          filtered.length === 0 ? -1 : i < 0 ? 0 : (i + 1) % filtered.length,
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) =>
          filtered.length === 0
            ? -1
            : i < 0
              ? filtered.length - 1
              : (i - 1 + filtered.length) % filtered.length,
        );
        break;
      case "Enter": {
        e.preventDefault();
        const wt = filtered[activeIndex];
        if (wt) {
          onOpenWorktree(wt.path);
          onClose();
        }
        break;
      }
      case "Escape":
        e.preventDefault();
        onClose();
        break;
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className="flex flex-col h-full overflow-hidden"
      onKeyDown={handleKeyDown}
    >
      {/* Search + Action */}
      <div className="flex items-center gap-2 p-2 border-b border-border">
        <div className="flex-1 flex items-center gap-2 px-2.5 py-2 rounded-lg bg-surface border border-border focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20 transition-all">
          <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(-1);
            }}
            placeholder={t("worktree.filterWorktrees")}
            className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
          />
        </div>
        <button
          onClick={() => {
            onCreateWorktree();
            onClose();
          }}
          className="shrink-0 px-3 py-2 text-sm font-medium text-primary-foreground bg-primary hover:bg-primary-hover rounded-lg transition-colors"
        >
          {t("worktree.newWorktree")}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <WorktreeList
          worktrees={filtered}
          currentPath={currentPath}
          activeIndex={activeIndex}
          onOpen={(path) => {
            onOpenWorktree(path);
            onClose();
          }}
          onRemove={onRemoveWorktree}
        />
      </div>
    </div>
  );
}

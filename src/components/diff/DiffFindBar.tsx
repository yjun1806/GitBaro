import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { clsx } from "clsx";
import { CaseSensitive, ChevronDown, ChevronUp, X } from "lucide-react";

interface DiffFindBarProps {
  query: string;
  caseSensitive: boolean;
  /** 지금 가리키는 일치(0부터). */
  active: number;
  count: number;
  /** 상한에 걸려 더 있을 수 있음. */
  capped: boolean;
  /** 입력이 아직 찾기에 반영되지 않음(잠깐 기다리는 중) — 이전 결과 수를 보이지 않는다. */
  pending: boolean;
  /** 값이 바뀔 때마다 입력 칸에 포커스를 주고 글을 고른다(⌘F를 다시 눌렀을 때). */
  focusSignal: number;
  onQueryChange: (query: string) => void;
  onToggleCase: () => void;
  onStep: (dir: 1 | -1) => void;
  onClose: () => void;
}

const ICON_BUTTON =
  "flex items-center justify-center w-6 h-6 rounded-(--radius-chip) text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none";

/** diff 위에 뜨는 찾기 칸. 찾기 자체는 부모가 하고, 여기는 입력과 버튼만 둔다. */
export function DiffFindBar({
  query,
  caseSensitive,
  active,
  count,
  capped,
  pending,
  focusSignal,
  onQueryChange,
  onToggleCase,
  onStep,
  onClose,
}: DiffFindBarProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusSignal]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      // 크게 보기의 Escape(창 전체 리스너)까지 가지 않게 여기서 끝낸다.
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onStep(e.shiftKey ? -1 : 1);
    }
  };

  const status = !query || pending
    ? ""
    : count === 0
      ? t("diffFind.noResults")
      : t("diffFind.count", { current: active + 1, total: capped ? `${count}+` : count });

  return (
    <div
      role="search"
      className="flex items-center gap-1 px-3 h-[32px] bg-card border-b border-(--line) shrink-0"
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t("diffFind.placeholder")}
        aria-label={t("diffFind.placeholder")}
        spellCheck={false}
        className="flex-1 min-w-0 h-6 px-2 rounded-(--radius-chip) bg-(--chip) text-xs font-mono text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
      />
      <span className="shrink-0 min-w-[64px] text-right text-[11.5px] tabular-nums text-muted-foreground" aria-live="polite">
        {status}
      </span>
      <button
        type="button"
        onClick={onToggleCase}
        aria-pressed={caseSensitive}
        aria-label={t("diffFind.caseSensitive")}
        title={t("diffFind.caseSensitive")}
        className={clsx(ICON_BUTTON, caseSensitive && "bg-accent text-foreground")}
      >
        <CaseSensitive className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => onStep(-1)}
        disabled={count === 0}
        aria-label={t("diffFind.previous")}
        title={t("diffFind.previous")}
        className={ICON_BUTTON}
      >
        <ChevronUp className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onStep(1)}
        disabled={count === 0}
        aria-label={t("diffFind.next")}
        title={t("diffFind.next")}
        className={ICON_BUTTON}
      >
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label={t("diffFind.close")}
        title={t("diffFind.close")}
        className={ICON_BUTTON}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

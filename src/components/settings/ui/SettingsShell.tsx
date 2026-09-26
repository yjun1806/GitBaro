import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Dialog } from "@/components/ui/Dialog";
import { SettingsNav, type SettingsNavItem } from "./SettingsNav";

interface SettingsShellProps<T extends string> {
  /** 창 제목(왼쪽 칸 맨 위). */
  title: string;
  /** 제목 아래 작은 글(예: 저장소 폴더 이름). */
  subtitle?: ReactNode;
  /** 제목 앞 그림(예: 저장소 아바타). */
  leading?: ReactNode;
  items: readonly SettingsNavItem<T>[];
  active: T;
  onSelect: (id: T) => void;
  onClose: () => void;
  children: ReactNode;
}

/**
 * 앱 설정과 저장소 설정이 함께 쓰는 설정 창 틀.
 * 왼쪽은 층 0(창 틀 색) 칸 목록, 오른쪽은 층 1(바탕) 위에 흰 카드가 세로로 쌓이는 스크롤 칸이다.
 * Escape로 닫고, 여는 동안 Tab은 창 안에서만 돈다(`Dialog`).
 */
export function SettingsShell<T extends string>({
  title,
  subtitle,
  leading,
  items,
  active,
  onSelect,
  onClose,
  children,
}: SettingsShellProps<T>) {
  const { t } = useTranslation();
  const titleId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeItem = items.find((item) => item.id === active);

  // 칸을 바꾸면 오른쪽을 맨 위부터 보인다.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [active]);

  return (
    <Dialog
      onClose={onClose}
      labelledBy={titleId}
      className="flex w-[min(880px,calc(100vw-48px))] h-[min(640px,calc(100vh-48px))] overflow-hidden rounded-(--radius-panel) border border-border bg-background shadow-(--shadow-float)"
    >
      <aside className="flex flex-col w-[208px] shrink-0 bg-(--frame) border-r border-(--line2)">
        <div className="flex items-center gap-2.5 px-4 pt-4 pb-3 min-w-0">
          {leading}
          <div className="min-w-0">
            <h2 id={titleId} className="text-[14px] font-bold text-foreground truncate">
              {title}
            </h2>
            {subtitle && <p className="text-[11.5px] text-muted-foreground truncate">{subtitle}</p>}
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3">
          <SettingsNav items={items} active={active} onSelect={onSelect} ariaLabel={title} />
        </div>
      </aside>

      <div className="flex flex-col flex-1 min-w-0">
        <header className="flex items-center justify-between gap-3 h-12 shrink-0 pl-6 pr-3 border-b border-(--line)">
          <h3 className="text-[14px] font-semibold text-foreground truncate">{activeItem?.label}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            title={t("common.close")}
            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground outline-none transition-colors motion-reduce:transition-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <X className="w-4 h-4" />
          </button>
        </header>
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
          {/* 칸을 바꾸면 새 칸이 흐린 데서 선명해진다(key로 새로 그려 움직임을 다시 시작한다). */}
          <div key={active} className="flex flex-col gap-6 max-w-[640px] mx-auto px-6 py-5 animate-content-in">
            {children}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

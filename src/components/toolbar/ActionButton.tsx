import type { ReactNode } from "react";
import { ChevronDown, Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 툴바 폭이 이보다 좁으면 버튼 이름을 숨기고 아이콘·배지만 둔다. 툴바 줄(`@container`)의 폭 기준이다.
 * 기본 창(1400px)에서 사이드바를 펼쳐도 이름이 보이고, 최소 창(1024px)에서도 계정·설정이 잘리지 않게 고른 값이다.
 */
export const TOOLBAR_LABEL_CLASS = "hidden @min-[1100px]:inline";

/**
 * 꼭 필요하지 않은 부가 글자(동기화 오류 제목 등)는 이보다 넓을 때만 보인다. 좁으면 아이콘과 툴팁만 남는다.
 * 오류와 ↓ 배지가 함께 떠도 1100px 폭에서 계정·설정이 잘리지 않게 한다.
 */
export const TOOLBAR_WIDE_LABEL_CLASS = "hidden @min-[1280px]:inline";

/**
 * 툴바 git 작업 버튼 묶음. 시안 `toolbar()`(`gen_d.py:111-116`)의 흰 카드 한 칸이다.
 */
export function ActionGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex items-center gap-0.5 p-[3px] rounded-[11px] bg-card shadow-(--shadow-sm)"
    >
      {children}
    </div>
  );
}

interface ActionButtonProps {
  action: string;
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  /** 꺼진 이유 같은 안내. 꺼진 버튼은 마우스 이벤트를 받지 않으므로 감싼 span의 title로 단다. */
  hint?: string;
  /** 숫자 배지(↑ 커밋 수, 스태시 개수 등). 0이나 undefined면 그리지 않는다. */
  badge?: number;
  /** 배지 앞에 붙는 기호(↑·↓). */
  badgePrefix?: string;
  busy?: boolean;
  /** 강조(할 일이 있을 때). */
  highlighted?: boolean;
  /**
   * 오른쪽에 붙는 ▾ 메뉴 버튼. `disabled`를 주지 않으면 본 버튼과 같이 꺼진다.
   * 본 버튼이 꺼져도 메뉴 안의 다른 작업(force push 등)은 쓸 수 있어야 할 때 따로 준다.
   */
  menu?: { label: string; isOpen: boolean; onToggle: () => void; disabled?: boolean };
  /** 버튼이 목록·패널을 연다는 표시(▾)를 버튼 안에 붙인다. 시안 `gbtn(caret=True)`. */
  caret?: boolean;
}

/** 시안 `gbtn()`: 30px 높이, 아이콘 + 이름 + 배지. 메뉴가 있으면 ▾ 버튼을 오른쪽에 붙인다. */
export function ActionButton({
  action,
  icon: Icon,
  label,
  onClick,
  disabled = false,
  hint,
  badge,
  badgePrefix = "",
  busy = false,
  highlighted = false,
  menu,
  caret = false,
}: ActionButtonProps) {
  const showBadge = badge !== undefined && badge > 0;
  const accessibleLabel = [label, showBadge ? `${badgePrefix}${badge}` : null, hint]
    .filter(Boolean)
    .join(" — ");
  const menuDisabled = menu?.disabled ?? disabled;
  return (
    <span title={hint ?? label} className="inline-flex items-center">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={accessibleLabel}
        data-action={action}
        className={cn(
          "flex items-center gap-1.5 h-[30px] px-2.5 rounded-lg text-[12.5px] font-semibold transition-colors",
          menu && "pr-1.5 rounded-r-none",
          highlighted ? "text-primary" : "text-(--fg2)",
          disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-accent",
        )}
      >
        {busy ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Icon className="w-3.5 h-3.5" aria-hidden="true" />
        )}
        <span className={cn("whitespace-nowrap", TOOLBAR_LABEL_CLASS)}>{label}</span>
        {showBadge && (
          <span
            aria-hidden="true"
            className="h-4 min-w-4 px-[5px] box-border rounded-lg bg-primary text-primary-foreground text-[10.5px] font-bold flex items-center justify-center tabular-nums leading-none"
          >
            {badgePrefix}
            {badge}
          </span>
        )}
        {caret && <ChevronDown className="w-3 h-3 opacity-60" aria-hidden="true" />}
      </button>
      {menu && (
        <button
          type="button"
          onClick={menu.onToggle}
          disabled={menuDisabled}
          aria-label={menu.label}
          aria-haspopup="menu"
          aria-expanded={menu.isOpen}
          className={cn(
            "flex items-center justify-center h-[30px] w-5 rounded-r-lg text-(--fg2) transition-colors",
            menuDisabled ? "opacity-50 cursor-not-allowed" : "hover:bg-accent",
            menu.isOpen && "bg-accent",
          )}
        >
          <ChevronDown className="w-3 h-3 opacity-60" aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

interface ActionMenuItem {
  key: string;
  label: string;
  description?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/** ▾ 버튼이 여는 작은 메뉴. 고르면 닫는다. */
export function ActionMenu({ items, onClose }: { items: ActionMenuItem[]; onClose: () => void }) {
  return (
    <div
      role="menu"
      className="absolute right-0 top-full mt-2 w-64 py-1 bg-popover border border-border rounded-xl shadow-xl z-50 overflow-hidden"
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            item.onSelect();
            onClose();
          }}
          className="w-full flex flex-col items-start px-3 py-2 text-left hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
        >
          <span className={cn("text-sm font-medium leading-tight", item.danger && "text-danger")}>
            {item.label}
          </span>
          {item.description && (
            <span className="text-xs text-muted-foreground leading-tight mt-0.5">{item.description}</span>
          )}
        </button>
      ))}
    </div>
  );
}

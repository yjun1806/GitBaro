import { useRef, type ReactNode } from "react";
import { useMenuKeyboard } from "@/hooks/useMenuKeyboard";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { FLOATING_SURFACE } from "@/components/ui/layers";
import { TOOLBAR_BADGE, TOOLBAR_GROUP, TOOLBAR_ICON, toolbarButtonClass } from "./toolbar-button";
import { BusyIcon } from "@/components/ui/Spinner";

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
 * 툴바 버튼 묶음: 관련 버튼을 흰 카드 하나(`TOOLBAR_GROUP`)에 담는다. 묶음 사이는 틈으로 나눈다.
 */
export function ActionGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} data-toolbar-group className={TOOLBAR_GROUP}>
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

/** 툴바 버튼(`toolbarButtonClass`): 아이콘 + 이름 + 배지. 메뉴가 있으면 ▾ 버튼을 오른쪽에 붙인다. */
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
        aria-busy={busy}
        data-action={action}
        className={cn(
          toolbarButtonClass({ disabled, joinRight: Boolean(menu), open: menu?.isOpen }),
          // 할 일이 있는 작업(받을·올릴 커밋)은 글자를 한 단계 진하게 한다. 색은 쓰지 않는다.
          highlighted && !disabled && "text-foreground font-semibold",
        )}
      >
        <BusyIcon busy={busy} icon={<Icon className={TOOLBAR_ICON} aria-hidden="true" />} />
        <span className={cn("whitespace-nowrap", TOOLBAR_LABEL_CLASS)}>{label}</span>
        {showBadge && (
          <span
            aria-hidden="true"
            className={TOOLBAR_BADGE}
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
          className={toolbarButtonClass({ joinLeft: true, disabled: menuDisabled, open: menu.isOpen })}
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

/**
 * ▾ 버튼이 여는 작은 메뉴. 고르면 닫는다. 다른 메뉴와 같이 ↑/↓/Home/End로 옮겨 다니고,
 * Escape는 이 메뉴만 닫는다(뒤의 diff 크게 보기 등은 그대로 둔다).
 */
export function ActionMenu({ items, onClose }: { items: ActionMenuItem[]; onClose: () => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const { onKeyDown } = useMenuKeyboard(menuRef, onClose);
  return (
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={cn("absolute right-0 top-full mt-2 w-64 py-1 rounded-xl z-50 overflow-hidden animate-pop-in", FLOATING_SURFACE)}
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

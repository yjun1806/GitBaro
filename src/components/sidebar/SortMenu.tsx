import { useEffect, useRef, useState, type RefObject } from "react";
import { ArrowDownUp, Check } from "lucide-react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useMenuKeyboard } from "@/hooks/useMenuKeyboard";
import { SORT_MODES, type SortMode } from "@/lib/repo-tree";
import { cn } from "@/lib/utils";
import { FLOATING_SURFACE } from "@/components/ui/layers";

interface SortMenuProps {
  mode: SortMode;
  onChange: (mode: SortMode) => void;
  /** 메뉴가 열리고 닫힐 때 알린다 — 부모(`AccountHeader`)가 열려 있는 동안 버튼을 계속 보이게 쓴다. */
  onOpenChange?: (open: boolean) => void;
}

/** 메뉴 항목 이름(번역 키). 「사용자 지정」은 메뉴에서 끌어서 정한다는 설명을 붙인다. */
const MENU_LABEL_KEY: Record<SortMode, string> = {
  custom: "workspace.sort.customMenu",
  name: "workspace.sort.name",
  recent: "workspace.sort.recent",
  todo: "workspace.sort.todo",
};

const BUTTON_LABEL_KEY: Record<SortMode, string> = {
  ...MENU_LABEL_KEY,
  custom: "workspace.sort.custom",
};

/**
 * 계정 머리글의 정렬 메뉴(D2 시안): 사용자 지정 / 이름 / 최근 활동 / 할 일 먼저.
 * 트리 행 안에 있으므로 누르기·키 입력이 행의 접기로 새지 않게 막는다. 메뉴는 사이드바의
 * 스크롤 영역에 잘리지 않도록 body에 띄운다(React 이벤트는 그래도 행으로 올라가므로 막는다).
 */
export function SortMenu({ mode, onChange, onOpenChange }: SortMenuProps) {
  const { t } = useTranslation();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const label = `${t("workspace.sort.label")}: ${t(BUTTON_LABEL_KEY[mode])}`;

  const setOpen = (next: { x: number; y: number } | null) => {
    setAnchor(next);
    onOpenChange?.(next !== null);
  };

  const open = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    setOpen({ x: rect?.left ?? 0, y: rect ? rect.bottom + 4 : 0 });
  };

  return (
    <>
      {/* 이름 자리를 지키려고 글자 없는 아이콘 버튼으로 뒀다(W-Top-T4). 지금 정렬 모드는
          aria-label/title로만 알린다 — AccountHeader가 이 버튼을 hover/focus-within/열림일 때만 보인다. */}
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        aria-label={label}
        title={label}
        onClick={(e) => {
          e.stopPropagation();
          if (anchor) setOpen(null);
          else open();
        }}
        onKeyDown={(e) => e.stopPropagation()}
        className="ml-auto w-5 h-5 shrink-0 flex items-center justify-center rounded-[var(--radius-chip)] text-[var(--faint)] hover:text-foreground hover:bg-(--frame-hover) outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <ArrowDownUp className="w-3 h-3" aria-hidden="true" />
      </button>
      {anchor &&
        createPortal(
          <SortMenuPopup
            mode={mode}
            position={anchor}
            onPick={(next) => {
              setOpen(null);
              if (next !== mode) onChange(next);
            }}
            onClose={() => setOpen(null)}
            ignore={buttonRef}
          />,
          document.body,
        )}
    </>
  );
}

interface SortMenuPopupProps {
  mode: SortMode;
  position: { x: number; y: number };
  onPick: (mode: SortMode) => void;
  onClose: () => void;
  /** 바깥 누르기로 치지 않을 요소(메뉴를 여닫는 버튼). */
  ignore: RefObject<HTMLElement | null>;
}

function SortMenuPopup({ mode, position, onPick, onClose, ignore }: SortMenuPopupProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const { onKeyDown, restoreFocus } = useMenuKeyboard(ref, onClose);

  useEffect(() => {
    const handler = (e: globalThis.MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || ignore.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose, ignore]);

  // 창 오른쪽·아래로 넘치면 안쪽으로 당긴다.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth) el.style.left = `${Math.max(4, window.innerWidth - rect.width - 4)}px`;
    if (rect.bottom > window.innerHeight) el.style.top = `${Math.max(4, position.y - rect.height - 28)}px`;
  }, [position]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={t("workspace.sort.label")}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onClick={(e) => e.stopPropagation()}
      className={cn("fixed z-[100] w-[220px] p-[5px] rounded-[10px] outline-none", FLOATING_SURFACE)}
      style={{ left: position.x, top: position.y }}
    >
      {SORT_MODES.map((m) => {
        const current = m === mode;
        return (
          <button
            key={m}
            type="button"
            role="menuitem"
            aria-current={current ? "true" : undefined}
            onClick={() => {
              restoreFocus();
              onPick(m);
            }}
            className={cn(
              "w-full h-[30px] px-2.5 flex items-center gap-2 rounded-md text-[12.5px] text-foreground text-left outline-none",
              "hover:bg-accent focus-visible:bg-accent",
              current && "bg-accent font-medium",
            )}
          >
            <span className="w-3.5 shrink-0 flex items-center justify-center" aria-hidden="true">
              {current && <Check className="w-3 h-3" />}
            </span>
            {t(MENU_LABEL_KEY[m])}
          </button>
        );
      })}
    </div>
  );
}

import { useRef, useState } from "react";
import { ArrowDownUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SORT_MODES, type SortMode } from "@/lib/repo-tree";
import { cn } from "@/lib/utils";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { SIDEBAR_ICON_BUTTON, TILE_ICON } from "./row-style";

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
 * 트리 행 안에 있으므로 누르기·키 입력이 행의 접기로 새지 않게 막는다. 메뉴는 `ContextMenu`의
 * `anchored` 자리(D14)를 써서 사이드바 스크롤 영역에 잘리지 않는다.
 */
export function SortMenu({ mode, onChange, onOpenChange }: SortMenuProps) {
  const { t } = useTranslation();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const label = `${t("workspace.sort.label")}: ${t(BUTTON_LABEL_KEY[mode])}`;

  const setMenuOpen = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  return (
    <>
      {/* 이름 자리를 지키려고 글자 없는 아이콘 버튼으로 뒀다(W-Top-T4). 지금 정렬 모드는
          aria-label/title로만 알린다 — AccountHeader가 이 버튼을 hover/focus-within/열림일 때만 보인다. */}
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen(!open);
        }}
        onKeyDown={(e) => e.stopPropagation()}
        className={cn("ml-auto", SIDEBAR_ICON_BUTTON)}
      >
        <ArrowDownUp className={TILE_ICON} aria-hidden="true" />
      </button>
      {open && (
        <ContextMenu
          ariaLabel={t("workspace.sort.label")}
          anchored={{ anchorRef: buttonRef }}
          onClose={() => setMenuOpen(false)}
          sections={[
            {
              items: SORT_MODES.map((m) => ({
                label: t(MENU_LABEL_KEY[m]),
                checked: m === mode,
                onClick: () => {
                  if (m !== mode) onChange(m);
                },
              })),
            },
          ]}
        />
      )}
    </>
  );
}

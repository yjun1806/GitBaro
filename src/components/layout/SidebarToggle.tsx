import { useEffect, useRef, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { PanelLeft } from "lucide-react";
import { useUIStore } from "@/stores/ui";
import { TRAFFIC_LIGHT_INSET_PX } from "@/lib/layout-tokens";
import { TOOLBAR_ICON, toolbarButtonClass } from "@/components/toolbar/toolbar-button";

/**
 * 포커스가 있던 토글을 눌렀으면 다음에 보이는 쪽 토글이 포커스를 받는다. 숨긴 사이드바는 inert라
 * 그 안의 버튼에 있던 포커스가 body로 떨어지기 때문이다(키보드로 누른 경우).
 */
let focusNextToggle = false;

/**
 * 사이드바 숨기기·보이기 버튼. 사이드바가 보이면 사이드바 머리 줄에, 숨기면 툴바 맨 앞
 * (`HiddenSidebarLead`)에 놓인다. 두 자리 모두 트래픽 라이트 바로 뒤라 버튼이 제자리에 있다.
 * `placement`는 이 버튼이 놓인 자리다.
 */
export function SidebarToggleButton({ placement }: { placement: "sidebar" | "toolbar" }) {
  const { t } = useTranslation();
  const hidden = useUIStore((s) => s.sidebarHidden);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const ref = useRef<HTMLButtonElement>(null);
  const label = hidden ? t("shell.showSidebar") : t("shell.hideSidebar");
  const shown = (placement === "toolbar") === hidden;

  useEffect(() => {
    if (!shown || !focusNextToggle) return;
    focusNextToggle = false;
    ref.current?.focus();
  }, [shown]);

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    focusNextToggle = document.activeElement === e.currentTarget;
    toggleSidebar();
  };

  return (
    <button
      ref={ref}
      type="button"
      onClick={handleClick}
      aria-label={label}
      aria-expanded={!hidden}
      title={`${label} (⌘\\)`}
      className={toolbarButtonClass({ iconOnly: true })}
    >
      <PanelLeft className={TOOLBAR_ICON} />
    </button>
  );
}

/**
 * 사이드바를 숨겼을 때 툴바 맨 앞에 두는 것: 트래픽 라이트 자리(창을 끄는 영역)와 사이드바를 다시
 * 여는 버튼. 사이드바가 보이면 그 자리는 사이드바 머리 줄이 맡으므로 아무것도 그리지 않는다.
 */
export function HiddenSidebarLead() {
  const hidden = useUIStore((s) => s.sidebarHidden);
  if (!hidden) return null;
  return (
    <>
      <div className="h-full shrink-0" style={{ width: TRAFFIC_LIGHT_INSET_PX }} data-tauri-drag-region data-traffic-light-inset />
      <SidebarToggleButton placement="toolbar" />
    </>
  );
}

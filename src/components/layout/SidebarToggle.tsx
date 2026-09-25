import { useTranslation } from "react-i18next";
import { PanelLeft } from "lucide-react";
import { useUIStore } from "@/stores/ui";
import { TRAFFIC_LIGHT_INSET_PX } from "@/lib/layout-tokens";
import { TOOLBAR_ICON, toolbarButtonClass } from "@/components/toolbar/toolbar-button";

/**
 * 사이드바 숨기기·보이기 버튼. 사이드바가 보이면 사이드바 머리 줄에, 숨기면 툴바 맨 앞
 * (`HiddenSidebarLead`)에 놓인다. 두 자리 모두 트래픽 라이트 바로 뒤라 버튼이 제자리에 있다.
 */
export function SidebarToggleButton() {
  const { t } = useTranslation();
  const hidden = useUIStore((s) => s.sidebarHidden);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const label = hidden ? t("shell.showSidebar") : t("shell.hideSidebar");
  return (
    <button
      type="button"
      onClick={toggleSidebar}
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
      <SidebarToggleButton />
    </>
  );
}

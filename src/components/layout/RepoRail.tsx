import { useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { ListTree } from "lucide-react";
import { useUIStore } from "@/stores/ui";
import { useRepositoryStore } from "@/stores/repository";
import { useSelectRepo } from "@/hooks/useSelectRepo";
import { useSettings } from "@/api/queries";
import { RepoHeaderContextMenu } from "@/components/repository/RepoHeaderContextMenu";
import { RepoTree } from "@/components/sidebar/RepoTree";
import { useSidebarTreeData } from "@/components/sidebar/useSidebarTreeData";
import {
  HEADER_HEIGHT_CLASS,
  SIDEBAR_GUTTER_PX,
  SIDEBAR_HANDLE_WIDTH,
  TRAFFIC_LIGHT_INSET_PX,
} from "@/lib/layout-tokens";
import { cn } from "@/lib/utils";
import { TOOLBAR_ICON, toolbarButtonClass } from "@/components/toolbar/toolbar-button";
import type { RepoInfo } from "@/types";
import { SidebarToggleButton } from "./SidebarToggle";

interface RepoRailProps {
  /** 사이드바 폭(px). 셸이 사용자가 조절한 폭을 창에 맞춰 넘겨준다. */
  width: number;
}

/**
 * 왼쪽 사이드바. 계정 → 워크스페이스 → 저장소 → 워크트리 트리(`RepoTree`)를 보여 준다.
 * 상태는 보임(폭 조절 가능)과 숨김 둘뿐이다(`sidebarHidden`, ⌘\ 또는 머리 줄의 사이드바 버튼).
 * 맨 위 버튼은 모든 저장소 목록(`RepoListView`)을 열고 닫는다(`repoListOpen`). 목록 자체는
 * 메인 칸이 그린다(사이드바 안에 한 벌 더 그리지 않는다).
 *
 * 숨겨도 트리는 마운트된 채 화면 밖으로 밀려나기만 한다. 그래서 트리가 등록한 워크트리 감시가
 * 끊기지 않고, 다시 보일 때 펼침·스크롤 상태도 그대로다.
 */
export function RepoRail({ width }: RepoRailProps) {
  const { t } = useTranslation();
  const hidden = useUIStore((s) => s.sidebarHidden);
  const repoListOpen = useUIStore((s) => s.repoListOpen);
  const setRepoListOpen = useUIStore((s) => s.setRepoListOpen);
  const { data: settingsData = null } = useSettings();
  const removeRepo = useRepositoryStore((s) => s.removeRepo);
  const { selectRepo, fetchingPath } = useSelectRepo();
  const treeData = useSidebarTreeData();
  const [menu, setMenu] = useState<{ repo: RepoInfo; x: number; y: number } | null>(null);

  const openMenu = (repo: RepoInfo, e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ repo, x: e.clientX, y: e.clientY });
  };

  return (
    // 흐름 폭은 숨기거나 보일 때 한 번에 바뀐다. 메인 칸 크기가 애니메이션 내내 바뀌면 diff 가상 목록이
    // 매 프레임 다시 재어 흔들리므로, 움직이는 것은 그 위에 뜬 패널의 translate뿐이다.
    <div className="relative shrink-0 h-full" style={{ width: hidden ? 0 : width }}>
      <div
        data-sidebar-panel
        inert={hidden}
        style={{ width }}
        className={cn(
          // 시안의 사이드바는 바탕(canvas) 위에 선 없이 놓인다.
          "absolute inset-y-0 left-0 z-30 flex flex-col bg-(--frame)",
          "transition-transform duration-180 ease-out motion-reduce:transition-none",
          hidden && "-translate-x-full",
        )}
      >
        {/* 사이드바 머리글 줄 — 툴바(ToolbarRoot)와 같은 높이(HEADER_HEIGHT_CLASS)라
            아래 테두리가 창 위쪽에서 하나로 이어져 보인다. macOS 트래픽 라이트는 창의
            맨 왼쪽 위, 즉 이 줄 안에 있으므로 그 자리(TRAFFIC_LIGHT_INSET_PX)는 여기서
            예약한다(Overlay 타이틀바). 사이드바 버튼은 숨겼을 때 툴바에 놓이는 자리와 같다. */}
        <div className={cn("flex items-center gap-1.5 pr-2 shrink-0 border-b border-(--line2)", HEADER_HEIGHT_CLASS)}>
          <div className="h-full shrink-0" style={{ width: TRAFFIC_LIGHT_INSET_PX }} data-tauri-drag-region />
          <SidebarToggleButton placement="sidebar" />
          <button
            onClick={() => setRepoListOpen(!repoListOpen)}
            title={t("rail.allRepos")}
            aria-pressed={repoListOpen}
            className={cn(toolbarButtonClass({ open: repoListOpen }), "min-w-0 shrink justify-start")}
          >
            <ListTree className={TOOLBAR_ICON} />
            <span className="truncate">{t("rail.allRepos")}</span>
          </button>
        </div>

        {/* 오른쪽에 폭 조절 손잡이(창 틀 색)가 붙어 오른쪽 여백처럼 보인다.
            그 폭만큼 오른쪽 안쪽 여백을 줄여 좌우 여백을 같게 맞춘다. 스크롤 칸도 같은 값을 쓴다. */}
        <div
          className="flex-1 min-h-0 pt-2.5 pb-1 pl-(--sb-gutter-l) pr-(--sb-gutter-r)"
          style={{
            "--sb-gutter-l": `${SIDEBAR_GUTTER_PX}px`,
            "--sb-gutter-r": `${SIDEBAR_GUTTER_PX - SIDEBAR_HANDLE_WIDTH}px`,
          } as CSSProperties}
        >
          <RepoTree
            data={treeData}
            fetchingPath={fetchingPath}
            onSelectRepo={selectRepo}
            onRepoContextMenu={openMenu}
          />
        </div>
      </div>

      {/* 저장소 우클릭 메뉴 */}
      {menu && (
        <RepoHeaderContextMenu
          repo={menu.repo}
          settings={settingsData}
          position={{ x: menu.x, y: menu.y }}
          onRemove={() => {
            removeRepo(menu.repo.path);
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

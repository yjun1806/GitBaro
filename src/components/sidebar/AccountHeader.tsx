import { useState } from "react";
import { Check, ChevronsDownUp, ChevronsUpDown, FolderPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SORT_MODES, type SortMode } from "@/lib/repo-tree";
import { ContextMenu, contextMenuPoint, type ContextMenuSection } from "@/components/ui/ContextMenu";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace";
import { SortMenu } from "./SortMenu";
import { SIDEBAR_ICON_BUTTON, TILE_ICON } from "./row-style";
import { TreeRowFrame } from "./TreeRowFrame";
import { WorkspaceNameDialog } from "./WorkspaceDialogs";

interface AccountHeaderProps {
  label: string;
  /** 비교·저장용 계정 키(소문자). 정렬과 새 워크스페이스가 이 계정에 붙는다. */
  accountKey: string;
  /** 계정 안 저장소 수(워크스페이스 안 저장소와 조용한 저장소 포함) */
  repoCount: number;
  ownerType?: "User" | "Organization";
  sortMode: SortMode;
  /**
   * 정렬 메뉴와 새 워크스페이스 버튼을 보일지. 계정을 아직 모르는 임시 그룹(「Other」)에서는
   * 끈다. 그 키에 워크스페이스나 정렬을 저장하면 계정을 불러온 뒤 어느 계정에도 속하지 않는다.
   */
  showActions: boolean;
  expanded: boolean;
  onToggle: () => void;
  /**
   * 이 계정 안 워크스페이스·저장소 카드를 모두 접었는지. 우클릭 메뉴의 「모두 접기/펴기」가 쓴다.
   * `onFoldAll`이 없으면 그 항목을 두지 않는다.
   */
  allFolded?: boolean;
  onFoldAll?: (fold: boolean) => void;
}

/** 우클릭 메뉴의 정렬 항목 이름(번역 키). `SortMenu`와 같다. */
const SORT_LABEL_KEY: Record<SortMode, string> = {
  custom: "workspace.sort.customMenu",
  name: "workspace.sort.name",
  recent: "workspace.sort.recent",
  todo: "workspace.sort.todo",
};

/**
 * 계정 머리글: 사이드바 바탕 위의 한 줄 구역 제목. ▾/▸, 계정 이름(작은 굵은 회색), 저장소 수,
 * 정렬 메뉴. 아이콘 타일과 대문자 변환은 두지 않는다(아래 저장소 카드가 주인공이다).
 * 끝의 새 워크스페이스 버튼은 시안에 없다. README는 제안과 끌어 놓기로만 만든다고 적지만,
 * 끌어 놓을 워크스페이스가 먼저 있어야 해서 직접 만드는 입구로 더했다.
 */
export function AccountHeader({
  label,
  accountKey,
  repoCount,
  ownerType,
  sortMode,
  showActions,
  expanded,
  onToggle,
  allFolded = false,
  onFoldAll,
}: AccountHeaderProps) {
  const { t } = useTranslation();
  const setSortMode = useWorkspaceStore((s) => s.setSortMode);
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);
  const [creating, setCreating] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);

  // 우클릭 메뉴: 정렬(지금 모드에 ✓), 새 워크스페이스, 이 계정 안 모두 접기·펴기.
  const icon = "w-3.5 h-3.5";
  const menuSections: ContextMenuSection[] = [
    ...(showActions
      ? [
          {
            items: SORT_MODES.map((m) => ({
              label: t(SORT_LABEL_KEY[m]),
              icon: m === sortMode ? <Check className={icon} /> : undefined,
              onClick: () => setSortMode(accountKey, m),
            })),
          },
          {
            items: [
              {
                label: t("workspace.create"),
                icon: <FolderPlus className={icon} />,
                onClick: () => setCreating(true),
              },
            ],
          },
        ]
      : []),
    ...(onFoldAll
      ? [
          {
            items: [
              {
                label: allFolded ? t("menu.expandAllInAccount") : t("menu.collapseAllInAccount"),
                icon: allFolded ? <ChevronsUpDown className={icon} /> : <ChevronsDownUp className={icon} />,
                onClick: () => onFoldAll(!allFolded),
              },
            ],
          },
        ]
      : []),
  ];
  return (
    <>
      <TreeRowFrame
        level={1}
        depth={0}
        label={label}
        expanded={expanded}
        chevron="leading"
        surface="frame"
        onToggle={onToggle}
        onContextMenu={
          menuSections.length > 0
            ? (e) => {
                e.preventDefault();
                setMenuAt(contextMenuPoint(e));
              }
            : undefined
        }
        className="gap-1.5 group"
      >
        {/* 계정 이름 + 저장소 수가 너비를 먼저 갖는다 — 정렬·워크스페이스 버튼은 hover/focus/열림 때만
            나타나 이름을 밀어내지 않는다(W-Top-T4: 「MONDAY…」로 잘리던 문제). */}
        <span
          title={ownerType === "Organization" ? t("sidebarTree.card.organization", { name: label }) : label}
          className="text-[11.5px] font-bold text-muted-foreground truncate min-w-0"
        >
          {label}
        </span>
        <span className="text-[10.5px] text-[var(--faint)] tabular-nums shrink-0">{repoCount}</span>
        <span className="flex-1" />
        {showActions && (
          <span
            className={cn(
              // 버튼은 행 오른쪽 끝 위에 떠 있어 폭을 차지하지 않는다(계정 이름이 버튼 자리 때문에 잘리지 않게).
              // 투명하게만 숨겨서 Tab과 화면 읽기 프로그램은 그대로 닿는다. 보일 때는 hover 채움을 깔아 이름 끝을 덮는다.
              "absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 rounded-[var(--radius-chip)] bg-(--frame-hover) transition-opacity",
              sortOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
            )}
          >
            <SortMenu mode={sortMode} onChange={(mode) => setSortMode(accountKey, mode)} onOpenChange={setSortOpen} />
            <button
              type="button"
              title={t("workspace.create")}
              aria-label={t("workspace.create")}
              onClick={(e) => {
                e.stopPropagation();
                setCreating(true);
              }}
              onKeyDown={(e) => e.stopPropagation()}
              className={SIDEBAR_ICON_BUTTON}
            >
              <FolderPlus className={TILE_ICON} aria-hidden="true" />
            </button>
          </span>
        )}
      </TreeRowFrame>
      {menuAt && (
        <ContextMenu
          sections={menuSections}
          position={menuAt}
          onClose={() => setMenuAt(null)}
          ariaLabel={t("menu.accountMenu")}
        />
      )}
      {/* 창은 행 밖에 둔다. 행 안에 두면 창 안의 누르기가 React 트리를 따라 행의 접기로 올라간다. */}
      {creating && (
        <WorkspaceNameDialog
          mode="create"
          subject={label}
          onSubmit={(name) => createWorkspace(name, accountKey)}
          onClose={() => setCreating(false)}
        />
      )}
    </>
  );
}

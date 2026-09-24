import { useRef, useState, type MouseEvent } from "react";
import { Layers, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { useWorkspaceStore } from "@/stores/workspace";
import { useSelectRepo } from "@/hooks/useSelectRepo";
import { cn } from "@/lib/utils";
import { NEUTRAL_TILE, ROW_TITLE, TILE_ICON } from "./row-style";
import { RowSignals, type RowSignalValues } from "./RowSignals";
import { DraggableRow } from "./TreeDnd";
import { TreeRowFrame } from "./TreeRowFrame";
import { DeleteWorkspaceDialog, WorkspaceNameDialog } from "./WorkspaceDialogs";

interface WorkspaceRowProps {
  /** 트리 노드 키(`ws:<id>`) */
  nodeKey: string;
  workspaceId: string;
  name: string;
  /** 워크스페이스가 속한 계정의 표시 이름. 삭제 확인 문구에 쓴다. */
  accountLabel: string;
  /** 화면에 보이는 저장소 수. 검색 중에는 맞는 저장소만 센다. */
  repoCount: number;
  /** 워크스페이스에 실제로 든 저장소 수(검색으로 거르기 전). 삭제하면 이만큼 계정 아래로 옮겨진다. */
  memberCount: number;
  /** 안에 든 저장소 전체의 오른쪽 표시 값. 접혔을 때만 머리 줄에 보인다. */
  signals: RowSignalValues;
  now: number;
  expanded: boolean;
  /** 끌어서 옮길 수 있는지(저장소를 이 행 위에 놓을 수 있는지도 함께). 검색 중에는 끈다. */
  draggable: boolean;
  onToggle: () => void;
}

/**
 * 워크스페이스 카드의 머리 줄: 겹친 층 아이콘과 이름. 접혔을 때는 안에 든 저장소 전체의 합계 표시를 둔다.
 * 행을 누르면 워크스페이스를 고른다(메인 칸이 워크스페이스 화면으로 바뀌고 저장소 선택은 풀린다).
 * 접고 펴기는 ▾/▸ 표시를 누르거나 ←/→ 키로 한다.
 * 끌어서 계정 안 순서를 바꿀 수 있고, 저장소를 이 행 위에 놓으면 이 워크스페이스에 들어간다.
 * 우클릭 메뉴로 이름을 바꾸거나 삭제한다. 삭제해도 저장소는 계정 바로 아래로 돌아갈 뿐 지우지 않는다.
 */
type OpenDialog = "rename" | "delete" | null;

/**
 * 워크스페이스 행을 지운 뒤에도 남는 이웃 트리 행. 바로 위 행(계정 머리글이나 앞 행)은
 * 삭제의 영향을 받지 않고, 없으면 바로 아래 행(계정 아래로 올라올 첫 저장소)을 쓴다.
 */
function neighborRow(row: HTMLElement | null): HTMLElement | null {
  const tree = row?.closest('[role="tree"]');
  if (!row || !tree) return null;
  const items = Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]'));
  const i = items.indexOf(row);
  if (i < 0) return null;
  return items[i - 1] ?? items[i + 1] ?? null;
}

export function WorkspaceRow({
  nodeKey,
  workspaceId,
  name,
  accountLabel,
  repoCount,
  memberCount,
  signals,
  now,
  expanded,
  draggable,
  onToggle,
}: WorkspaceRowProps) {
  const { t } = useTranslation();
  const renameWorkspace = useWorkspaceStore((s) => s.renameWorkspace);
  const deleteWorkspace = useWorkspaceStore((s) => s.deleteWorkspace);
  const selected = useWorkspaceStore((s) => s.activeWorkspaceId === workspaceId);
  const { selectWorkspace } = useSelectRepo();
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  // 메뉴를 연 행. 삭제하면 이 행이 사라지므로, 그 전에 초점을 옮길 이웃 행을 여기서 찾는다.
  const rowRef = useRef<HTMLElement | null>(null);

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    rowRef.current = e.currentTarget as HTMLElement;
    // 키보드(메뉴 키)로 열면 좌표가 0이라 행 아래에 띄운다.
    if (e.clientX === 0 && e.clientY === 0) {
      const rect = e.currentTarget.getBoundingClientRect();
      setMenuAt({ x: rect.left + 16, y: rect.bottom });
    } else {
      setMenuAt({ x: e.clientX, y: e.clientY });
    }
  };

  return (
    <>
      <DraggableRow
        id={nodeKey}
        kind="workspace"
        label={name}
        depth={0}
        groupBelow={expanded && repoCount > 0}
        disabled={!draggable}
      >
        <TreeRowFrame
          level={2}
          label={name}
          expanded={expanded}
          selected={selected}
          onSelect={() => selectWorkspace(workspaceId)}
          onToggle={onToggle}
          onContextMenu={handleContextMenu}
        >
          <span className={NEUTRAL_TILE}>
            <Layers className={TILE_ICON} aria-hidden="true" />
          </span>
          <span className={cn(ROW_TITLE, "font-semibold")} title={t("sidebarTree.card.workspaceTitle", { name, count: repoCount })}>
            {name}
          </span>
          {!expanded && <RowSignals values={signals} now={now} />}
        </TreeRowFrame>
      </DraggableRow>
      {menuAt && (
        <ContextMenu
          position={menuAt}
          ariaLabel={t("workspace.menu.label")}
          onClose={() => setMenuAt(null)}
          sections={[
            {
              items: [
                {
                  label: t("workspace.menu.rename"),
                  icon: <Pencil className="w-3.5 h-3.5" />,
                  onClick: () => setDialog("rename"),
                },
              ],
            },
            {
              items: [
                {
                  label: t("workspace.menu.delete"),
                  icon: <Trash2 className="w-3.5 h-3.5" />,
                  variant: "danger",
                  onClick: () => setDialog("delete"),
                },
              ],
            },
          ]}
        />
      )}
      {dialog === "rename" && (
        <WorkspaceNameDialog
          mode="rename"
          subject={name}
          initialName={name}
          onSubmit={(next) => renameWorkspace(workspaceId, next)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "delete" && (
        <DeleteWorkspaceDialog
          name={name}
          accountLabel={accountLabel}
          repoCount={memberCount}
          onConfirm={() => {
            const next = neighborRow(rowRef.current);
            deleteWorkspace(workspaceId);
            setDialog(null);
            // 창은 원래 연 행으로 초점을 돌려주는데, 그 행이 없어졌으므로 바로 위(없으면 아래) 행으로 옮긴다.
            next?.focus();
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

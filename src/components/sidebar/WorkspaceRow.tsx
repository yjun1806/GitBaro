import { useState, type MouseEvent } from "react";
import { Folder, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { useWorkspaceStore } from "@/stores/workspace";
import { RowBadges } from "./RowBadges";
import { DraggableRow } from "./TreeDnd";
import { TreeRowFrame } from "./TreeRowFrame";
import type { Totals } from "./tree-model";
import { DeleteWorkspaceDialog, WorkspaceNameDialog } from "./WorkspaceDialogs";

interface WorkspaceRowProps {
  /** 트리 노드 키(`ws:<id>`) */
  nodeKey: string;
  workspaceId: string;
  name: string;
  /** 워크스페이스가 속한 계정의 표시 이름. 삭제 확인 문구에 쓴다. */
  accountLabel: string;
  repoCount: number;
  totals: Totals;
  expanded: boolean;
  /** 끌어서 옮길 수 있는지(저장소를 이 행 위에 놓을 수 있는지도 함께). 검색 중에는 끈다. */
  draggable: boolean;
  onToggle: () => void;
}

/**
 * 워크스페이스 행: 폴더 아이콘, 이름, 「워크스페이스 · 저장소 N」, 안에 든 저장소의 합계 표시.
 * 워크스페이스를 고르는 동작(여러 저장소 리뷰 화면)은 W4에서 붙는다. 지금은 누르면 접고 편다.
 * 끌어서 계정 안 순서를 바꿀 수 있고, 저장소를 이 행 위에 놓으면 이 워크스페이스에 들어간다.
 * 우클릭 메뉴로 이름을 바꾸거나 삭제한다. 삭제해도 저장소는 계정 바로 아래로 돌아갈 뿐 지우지 않는다.
 */
type OpenDialog = "rename" | "delete" | null;

export function WorkspaceRow({
  nodeKey,
  workspaceId,
  name,
  accountLabel,
  repoCount,
  totals,
  expanded,
  draggable,
  onToggle,
}: WorkspaceRowProps) {
  const { t } = useTranslation();
  const renameWorkspace = useWorkspaceStore((s) => s.renameWorkspace);
  const deleteWorkspace = useWorkspaceStore((s) => s.deleteWorkspace);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [dialog, setDialog] = useState<OpenDialog>(null);

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    // 키보드(메뉴 키)로 열면 좌표가 0이라 행 아래에 띄운다.
    if (e.clientX === 0 && e.clientY === 0) {
      const rect = e.currentTarget.getBoundingClientRect();
      setMenuAt({ x: rect.left + 16, y: rect.bottom });
    } else {
      setMenuAt({ x: e.clientX, y: e.clientY });
    }
  };

  const badges = <RowBadges dirty={totals.dirty} newCommits={totals.newCommits} />;
  return (
    <>
      <DraggableRow
        id={nodeKey}
        kind="workspace"
        label={name}
        depth={0}
        groupBelow={expanded && repoCount > 0}
        badges={badges}
        disabled={!draggable}
      >
        <TreeRowFrame
          level={2}
          depth={0}
          label={name}
          expanded={expanded}
          onToggle={onToggle}
          onContextMenu={handleContextMenu}
          tall
        >
          <span className="w-5 h-5 rounded-[var(--radius-chip)] bg-muted flex items-center justify-center shrink-0">
            <Folder className="w-[13px] h-[13px] text-[var(--fg2)]" aria-hidden="true" />
          </span>
          <span className="flex-1 min-w-0 flex flex-col gap-px">
            <span className="text-[12.5px] font-bold text-foreground truncate">{name}</span>
            <span className="text-[10.5px] text-muted-foreground truncate">
              {t("sidebarTree.workspaceSubtitle", { count: repoCount })}
            </span>
          </span>
          {badges}
        </TreeRowFrame>
      </DraggableRow>
      {menuAt && (
        <ContextMenu
          position={menuAt}
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
          repoCount={repoCount}
          onConfirm={() => {
            deleteWorkspace(workspaceId);
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

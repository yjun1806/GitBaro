import { useTranslation } from "react-i18next";
import { Plus, Minus, Code2, FolderOpen, Copy, EyeOff, Undo2 } from "lucide-react";
import { ContextMenu } from "@/components/ui/ContextMenu";
import type { ContextMenuSection } from "@/components/ui/ContextMenu";
import { useMenuActions } from "@/hooks/useMenuActions";
import { joinRepoPath } from "@/lib/utils";

/** 작업 중인 변경 목록의 행에만 있는 동작(스테이지·버리기). */
export interface WorkingFileMenuActions {
  staged: boolean;
  canDiscard: boolean;
  onToggleStage: () => void;
  onDiscard: () => void;
  /** 없으면 「.gitignore에 추가」를 두지 않는다. */
  onAddToGitignore?: () => void;
}

interface FileContextMenuProps {
  /** 파일이 든 저장소(워크트리) 경로. */
  repoPath: string;
  /** 저장소 기준 파일 경로. */
  filePath: string;
  /** 작업 폴더에 파일이 없으면(지운 파일) 편집기·Finder 열기를 막는다. */
  exists?: boolean;
  /** 작업 중인 변경 목록에서 열었을 때만 준다. 커밋 목록은 읽기 전용이다. */
  working?: WorkingFileMenuActions;
  position: { x: number; y: number };
  onClose: () => void;
}

/**
 * 파일 행의 우클릭 메뉴. 모든 파일 목록(작업 중인 변경, 커밋의 파일, 따라가기, 스태시,
 * 크게 보는 diff 옆 목록)이 같은 메뉴를 쓴다. 되돌리기는 맨 아래에 따로 두고 확인 창을 거친다.
 */
export function FileContextMenu({
  repoPath,
  filePath,
  exists = true,
  working,
  position,
  onClose,
}: FileContextMenuProps) {
  const { t } = useTranslation();
  const actions = useMenuActions();
  const icon = "w-3.5 h-3.5";

  const sections: ContextMenuSection[] = [];
  if (working) {
    sections.push({
      items: [
        {
          label: working.staged ? t("changes.contextMenu.unstage") : t("changes.contextMenu.stage"),
          icon: working.staged ? <Minus className={icon} /> : <Plus className={icon} />,
          onClick: working.onToggleStage,
        },
      ],
    });
  }
  sections.push(
    {
      items: [
        {
          label: t("changes.contextMenu.openInEditor"),
          icon: <Code2 className={icon} />,
          onClick: () => actions.openFileInEditor(repoPath, filePath),
          disabled: !exists,
        },
        {
          label: t("changes.contextMenu.revealInFinder"),
          icon: <FolderOpen className={icon} />,
          onClick: () => actions.reveal(joinRepoPath(repoPath, filePath)),
          disabled: !exists,
        },
      ],
    },
    {
      items: [
        {
          label: t("menu.copyRelativePath"),
          icon: <Copy className={icon} />,
          onClick: () => actions.copy(filePath),
        },
        {
          label: t("menu.copyFullPath"),
          icon: <Copy className={icon} />,
          onClick: () => actions.copy(joinRepoPath(repoPath, filePath)),
        },
        ...(working?.onAddToGitignore
          ? [
              {
                label: t("changes.contextMenu.addToGitignore"),
                icon: <EyeOff className={icon} />,
                onClick: working.onAddToGitignore,
              },
            ]
          : []),
      ],
    },
  );
  if (working) {
    sections.push({
      items: [
        {
          label: t("changes.contextMenu.discard"),
          icon: <Undo2 className={icon} />,
          variant: "danger",
          onClick: working.onDiscard,
          disabled: !working.canDiscard,
        },
      ],
    });
  }

  return (
    <ContextMenu sections={sections} position={position} onClose={onClose} ariaLabel={t("menu.fileMenu")} />
  );
}

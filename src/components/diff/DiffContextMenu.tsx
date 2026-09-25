import { useTranslation } from "react-i18next";
import { Code2, Copy, TextSelect } from "lucide-react";
import { ContextMenu, type ContextMenuSection } from "@/components/ui/ContextMenu";
import { useMenuActions } from "@/hooks/useMenuActions";
import { joinRepoPath } from "@/lib/utils";
import type { DiffMenuLine } from "./VirtualizedDiffView";

interface DiffContextMenuProps {
  /** 우클릭할 때 골라 둔 글. 없으면 빈 문자열. */
  selection: string;
  /** 우클릭한 코드 줄. 문서 보기이거나 줄이 아닌 곳이면 null. */
  line: DiffMenuLine | null;
  filePath: string;
  /** 파일이 든 저장소(워크트리). 모르면 편집기 열기를 두지 않는다. */
  repoPath: string | null;
  position: { x: number; y: number };
  onClose: () => void;
}

/**
 * diff 본문 우클릭 메뉴: 고른 글 복사, 그 줄 복사, 파일을 편집기에서 열기, 경로 복사.
 * 편집기 열기 명령은 줄 번호를 받지 않아 파일만 연다. hunk 단위 스테이지는 이 앱에 없어 두지 않는다.
 */
export function DiffContextMenu({ selection, line, filePath, repoPath, position, onClose }: DiffContextMenuProps) {
  const { t } = useTranslation();
  const actions = useMenuActions();
  const icon = "w-3.5 h-3.5";

  const copyItems = [
    ...(selection
      ? [{ label: t("menu.copySelection"), icon: <TextSelect className={icon} />, onClick: () => actions.copy(selection) }]
      : []),
    ...(line
      ? [
          {
            label: t("menu.copyLine", { line: line.lineNumber }),
            icon: <Copy className={icon} />,
            onClick: () => actions.copy(line.text),
          },
        ]
      : []),
  ];
  const sections: ContextMenuSection[] = [
    ...(copyItems.length > 0 ? [{ items: copyItems }] : []),
    {
      items: [
        ...(repoPath
          ? [
              {
                label: t("menu.openFileInEditor"),
                icon: <Code2 className={icon} />,
                onClick: () => actions.openFileInEditor(repoPath, filePath),
                // 지운 줄만 있는 파일(삭제된 파일)은 열 파일이 없다 — 여는 것은 편집기가 알려 준다.
              },
            ]
          : []),
        { label: t("menu.copyRelativePath"), icon: <Copy className={icon} />, onClick: () => actions.copy(filePath) },
        ...(repoPath
          ? [
              {
                label: t("menu.copyFullPath"),
                icon: <Copy className={icon} />,
                onClick: () => actions.copy(joinRepoPath(repoPath, filePath)),
              },
            ]
          : []),
      ],
    },
  ];

  return <ContextMenu sections={sections} position={position} onClose={onClose} ariaLabel={t("menu.diffMenu")} />;
}

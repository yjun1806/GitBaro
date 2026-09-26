import { useState, type ReactNode } from "react";
import { FileContextMenu } from "./FileContextMenu";

interface OpenFileMenu {
  repoPath: string;
  filePath: string;
  exists: boolean;
  x: number;
  y: number;
}

/**
 * 읽기 전용 파일 목록(커밋의 파일, 스태시)의 우클릭 메뉴. 편집기·Finder 열기와
 * 경로 복사만 있다. 스테이지·되돌리기는 작업 중인 변경 목록(`useWorkingFileMenu`)에만 있다.
 */
export function useFileMenu(): {
  open: (
    target: { repoPath: string; filePath: string; exists?: boolean },
    position: { x: number; y: number },
  ) => void;
  element: ReactNode;
} {
  const [menu, setMenu] = useState<OpenFileMenu | null>(null);
  return {
    open: ({ repoPath, filePath, exists = true }, { x, y }) => setMenu({ repoPath, filePath, exists, x, y }),
    element: menu ? (
      <FileContextMenu
        repoPath={menu.repoPath}
        filePath={menu.filePath}
        exists={menu.exists}
        position={{ x: menu.x, y: menu.y }}
        onClose={() => setMenu(null)}
      />
    ) : null,
  };
}

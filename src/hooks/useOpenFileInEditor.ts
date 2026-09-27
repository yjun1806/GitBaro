import { useTranslation } from "react-i18next";
import { useMenuActions } from "@/hooks/useMenuActions";
import { useToastStore } from "@/stores/toast";

/**
 * 파일 목록 행을 더블클릭해 편집기에서 여는 공용 동작. 우클릭 메뉴의 「편집기에서 열기」
 * (`useMenuActions().openFileInEditor`)와 같은 경로를 쓴다. `exists`가 false면(작업 폴더에
 * 없는 파일 — 지운 파일, 체크아웃하지 않은 PR의 파일 등) 열지 않고 이유를 토스트로 알린다.
 */
export function useOpenFileInEditor(): (repoPath: string, filePath: string, exists?: boolean) => void {
  const { t } = useTranslation();
  const actions = useMenuActions();
  const addToast = useToastStore((s) => s.addToast);
  return (repoPath, filePath, exists = true) => {
    if (!exists) {
      addToast(t("menu.cannotOpenDeleted"), "info");
      return;
    }
    actions.openFileInEditor(repoPath, filePath);
  };
}

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { openInEditor, openInTerminal, openRepoInEditor, revealInFinder } from "@/api/commands";
import { useToastStore } from "@/stores/toast";
import { getErrorMessage } from "@/lib/utils";

export interface MenuActions {
  /** 클립보드에 넣고 짧게 알린다. */
  copy: (text: string) => void;
  /** Finder에서 파일·폴더를 보여 준다. */
  reveal: (path: string) => void;
  /** 폴더를 터미널에서 연다. */
  openTerminal: (path: string) => void;
  /** 폴더를 기본 편집기에서 연다. */
  openFolderInEditor: (path: string) => void;
  /** 저장소 안 파일을 기본 편집기에서 연다. */
  openFileInEditor: (repoPath: string, filePath: string) => void;
  /** 브라우저에서 연다. */
  openInBrowser: (url: string) => void;
}

/**
 * 우클릭 메뉴가 공통으로 쓰는 동작. 이미 있는 명령(Finder·터미널·편집기·브라우저 열기)을 부르고,
 * 실패하면 알림으로 이유를 보인다.
 */
export function useMenuActions(): MenuActions {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  return useMemo(() => {
    const fail = (key: string) => (err: unknown) => addToast(t(key, { error: getErrorMessage(err) }), "error");
    return {
      copy: (text) => {
        navigator.clipboard.writeText(text).then(
          () => addToast(t("menu.copied"), "success"),
          fail("menu.copyFailed"),
        );
      },
      reveal: (path) => void revealInFinder(path).catch(fail("menu.revealFailed")),
      openTerminal: (path) => void openInTerminal(path).catch(fail("gitActions.terminalFailed")),
      openFolderInEditor: (path) => void openRepoInEditor(path).catch(fail("error.failedToOpenEditor")),
      openFileInEditor: (repoPath, filePath) =>
        void openInEditor(repoPath, filePath).catch((err: unknown) => {
          const msg = getErrorMessage(err);
          if (msg.includes("No default editor") || msg.includes("Unknown editor")) {
            addToast(t("settings.editorNotSet"), "warning");
          } else {
            addToast(t("error.failedToOpenEditor", { error: msg }), "error");
          }
        }),
      openInBrowser: (url) => void openUrl(url).catch(fail("menu.openUrlFailed")),
    };
  }, [t, addToast]);
}

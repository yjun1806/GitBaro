import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAccountStore } from "@/stores/account";
import { useRepositoryStore } from "@/stores/repository";
import { useSelectionStore } from "@/stores/selection";
import { useUIStore } from "@/stores/ui";
import { usePrViewStore } from "@/components/pr/pr-view";
import { useFilesViewStore } from "@/components/review/files-view";
import type { NotificationTarget } from "./target";

/** 창을 앞으로 가져온다. 최소화돼 있으면 되살린다. */
export async function focusMainWindow(): Promise<void> {
  const win = getCurrentWindow();
  try {
    await win.unminimize();
    await win.show();
    await win.setFocus();
  } catch {
    /* 창을 못 움직여도 화면 전환은 한다 */
  }
}

/**
 * 알림이 가리키는 저장소·워크트리를 연다. 새 커밋이면 「기록」 탭에서 그 커밋을, CI 실패면
 * 「Actions」 탭에서 그 실행을 고른다. 저장소가 목록에서 빠졌으면 아무것도 하지 않는다.
 */
export function openNotificationTarget(target: NotificationTarget): void {
  const { repos, setActiveRepo, rememberWorktree } = useRepositoryStore.getState();
  const repo = repos.find((r) => r.path === target.repoPath);
  if (!repo) return;

  // 저장소를 바꾸면 선택이 지워지므로(selection 스토어 구독) 전환을 먼저 한다.
  setActiveRepo(target.worktreePath, target.repoPath);
  rememberWorktree(target.repoPath, target.worktreePath === target.repoPath ? null : target.worktreePath);
  if (repo.accountId) useAccountStore.getState().setActiveAccount(repo.accountId);

  // PR 보기·「파일별 변경」 탭이 열려 있으면 그 뒤에 가려진다. GraphPanel은 탭 값이 바뀔 때만
  // 둘을 닫으므로, 이미 같은 탭이었을 때를 위해 여기서 닫는다.
  usePrViewStore.getState().setOpen(false);
  useFilesViewStore.getState().setRepoTabOpen(false);
  const { setActiveTab } = useUIStore.getState();
  const selection = useSelectionStore.getState();
  if (target.kind === "commit") {
    setActiveTab("history");
    selection.selectCommit(target.commitOid);
  } else {
    setActiveTab("actions");
    selection.selectRun(target.runId);
  }
}
